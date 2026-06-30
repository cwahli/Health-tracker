import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UserProfile, DbInteraction, QuotaData, FoodLog } from '../types';
import { translations } from '../utils/translations';
import { Eye, EyeOff, CloudLightning, CloudCheck, RefreshCw, LogOut, Check, ShieldCheck } from 'lucide-react';
import { db, auth } from '../firebase';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import GoogleHealthIntegration from './GoogleHealthIntegration';
import FullScreenLogViewer from './FullScreenLogViewer';

const ColorPickerField = ({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-150 dark:border-slate-800 gap-2">
    <div className="min-w-0 text-left">
      <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">{label}</span>
    </div>
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 text-xs px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md font-mono text-slate-700 dark:text-slate-300"
      />
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer overflow-hidden bg-transparent shrink-0"
        style={{ padding: 0, border: 'none' }}
      />
    </div>
  </div>
);

const TIMEZONES = [
  "Pacific/Midway", "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", 
  "America/Denver", "America/Chicago", "America/New_York", "America/Caracas", 
  "America/Buenos_Aires", "Atlantic/Azores", "Europe/London", "Europe/Paris", 
  "Africa/Cairo", "Europe/Moscow", "Asia/Dubai", "Asia/Karachi", "Asia/Dhaka", 
  "Asia/Bangkok", "Asia/Hong_Kong", "Asia/Tokyo", "Australia/Sydney", "Pacific/Noumea", "Pacific/Auckland"
];

const formatTimezone = (tz: string) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
    const parts = formatter.formatToParts(new Date());
    const tzName = parts.find(p => p.type === 'timeZoneName')?.value;
    const city = tz.split('/')[1]?.replace(/_/g, ' ') || tz;
    return `${city} (${tzName?.replace('GMT', 'UTC') || 'UTC'})`;
  } catch (e) {
    return tz;
  }
};

interface HeaderProps {
  profile: UserProfile;
  setProfile: (p: UserProfile) => void;
  onSaveProfile?: (p: UserProfile) => Promise<void>;
  hideSensitive: boolean;
  setHideSensitive: (h: boolean) => void;
  syncState: 'synced' | 'syncing' | 'local';
  onSignOut: () => void;
  onCloudSync?: () => Promise<void>;
  dbInteractions?: DbInteraction[];
  quota?: QuotaData;
  foodLogs?: FoodLog[];
  activeTab?: string;
}

const getSessionId = (): string => {
  if (typeof window === 'undefined') return 'global';
  let id = sessionStorage.getItem('app_session_id');
  if (!id) {
    id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('app_session_id', id);
  }
  return id;
};

export default function Header({
  profile,
  setProfile,
  onSaveProfile,
  hideSensitive,
  setHideSensitive,
  syncState,
  onSignOut,
  onCloudSync,
  dbInteractions = [],
  quota,
  foodLogs = [],
  activeTab = 'home'
}: HeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showThemeScreen, setShowThemeScreen] = useState(false);
  const [showDbInteractionsOverlay, setShowDbInteractionsOverlay] = useState(false);
  const [nickname, setNickname] = useState(profile.nickname);
  const [age, setAge] = useState<number | string>(profile.age);
  const [ethnicity, setEthnicity] = useState(profile.ethnicity);
  const [weight, setWeight] = useState<number | string>(profile.weight);
  const [height, setHeight] = useState<number | string>(profile.height);
  const [bloodType, setBloodType] = useState<string>(profile.bloodType || '');
  const [gender, setGender] = useState<string>(profile.gender || 'Unknown');
  const [timezone, setTimezone] = useState<string>(profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [now, setNow] = useState(Date.now());
  const t = translations[profile.language] || translations.en;

  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('agent_debug_mode') === 'true');
  const [debugLogs, setDebugLogs] = useState<{ timestamp: string, message: string }[]>([]);
  const [serverStartTime, setServerStartTime] = useState<number | null>(null);
  const [isSendingLogs, setIsSendingLogs] = useState(false);
  const [logsSendStatus, setLogsSendStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [showFullScreenDebugLogs, setShowFullScreenDebugLogs] = useState(false);

  const handleToggleDebugMode = (enabled: boolean) => {
    setDebugMode(enabled);
    localStorage.setItem('agent_debug_mode', enabled ? 'true' : 'false');
  };

  const handleClearDebugLogs = async () => {
    try {
      const res = await fetch('/api/gemini/clear-debug-logs', { 
        method: 'POST',
        headers: {
          'X-Session-ID': getSessionId()
        }
      });
      if (res.ok) {
        const data = await res.json();
        setDebugLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Error clearing debug logs:", err);
    }
  };

  const handleSendLogToAdmin = async () => {
    setIsSendingLogs(true);
    setLogsSendStatus('idle');
    try {
      const logsText = debugLogs.map(l => `[${l.timestamp}] ${l.message}`).join('\n');
      const sessionId = getSessionId();
      
      const res = await fetch('/api/gemini/send-logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({ logsText })
      });
      
      if (res.ok) {
        setLogsSendStatus('success');
        
        // Native mailto link fallback
        const subject = encodeURIComponent(`Healthy App Debug Logs - Session ${sessionId}`);
        const body = encodeURIComponent(`Hello Admin,\n\nHere is the compiled log history for session ${sessionId}:\n\n${logsText}`);
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

  // Fetch real server start time
  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => {
        if (d && typeof d.startTime === 'number') {
          setServerStartTime(d.startTime);
        }
      })
      .catch(e => console.error("Error fetching status:", e));
  }, []);

  useEffect(() => {
    let interval: any;
    if (showDbInteractionsOverlay) {
      interval = setInterval(() => setNow(Date.now()), 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showDbInteractionsOverlay]);

  useEffect(() => {
    let interval: any;
    if (showDbInteractionsOverlay) {
      const fetchLogs = async () => {
        try {
          const res = await fetch('/api/gemini/debug-logs', {
            headers: {
              'X-Session-ID': getSessionId()
            }
          });
          if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.logs)) {
              setDebugLogs(data.logs);
            }
          }
        } catch (err) {
          console.error("Error fetching debug logs:", err);
        }
      };
      
      fetchLogs(); // initial fetch
      interval = setInterval(fetchLogs, 1500); // poll every 1.5s
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showDbInteractionsOverlay]);

  useEffect(() => {
    setNickname(profile.nickname);
    setAge(profile.age);
    setEthnicity(profile.ethnicity);
    setWeight(profile.weight);
    setHeight(profile.height);
    setBloodType(profile.bloodType || '');
    setGender(profile.gender || 'Unknown');
    setTimezone(profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [profile]);

  const handleSave = () => {
    const finalProfile = {
      ...profile,
      nickname,
      age: Number(age) || 0,
      ethnicity,
      weight: Number(weight) || 0,
      height: Number(height) || 0,
      bloodType,
      gender,
      timezone
    };
    if (onSaveProfile) {
      onSaveProfile(finalProfile);
    } else {
      setProfile(finalProfile);
    }
    setIsEditing(false);
  };

  return (
    <>
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800/80 px-6 py-4 sticky top-0 z-40 shadow-sm transition-colors duration-200">
        <div className="max-w-md mx-auto flex items-center justify-between gap-3">
        {/* Profile Info Row */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <button 
            id="avatar-edit-btn"
            onClick={() => setIsEditing(!isEditing)} 
            className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-indigo-500/20 flex-shrink-0 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <img 
              src={profile.photoUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"} 
              alt="User profile" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </button>
          
          <div className="min-w-0 flex-1">
            <div className="flex flex-col justify-center">
              <span id="user-nickname-text" className="font-semibold text-slate-950 dark:text-slate-100 truncate text-base leading-tight">
                {profile.nickname || 'Healthy User'}
              </span>
              <span className="text-[10px] text-slate-400 capitalize font-medium mt-0.5 block tracking-wide">
                {activeTab === 'home' ? 'Home' : activeTab === 'insights' ? 'Insights & Analytics' : activeTab === 'food' ? 'Food & Nutrition Logs' : activeTab === 'medical' ? 'Medical History' : activeTab === 'trends' ? 'Health Trends' : activeTab}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Sync Status Icon Indicator */}
          <button
            id="cloud-sync-btn"
            onClick={() => setShowDbInteractionsOverlay(true)}
            className="flex items-center p-2 rounded-xl text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer relative"
            title="View database synchronization & diagnostics"
          >
            {syncState === 'syncing' && (
              <RefreshCw className="w-5 h-5 text-indigo-600 animate-spin" />
            )}
            {syncState === 'synced' && (
              <CloudCheck className="w-5.5 h-5.5 text-slate-400 dark:text-slate-500" />
            )}
            {syncState === 'local' && (
              <CloudLightning className="w-5 h-5 text-amber-500 animate-pulse" />
            )}
            {dbInteractions.some(o => o.status === 'pending') && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-indigo-600 rounded-full animate-ping" />
            )}
          </button>
        </div>
      </div>
    </header>

      {/* Editing Dialog Slide-down for Profile Parameters */}
      {isEditing && createPortal((
        <div id="profile-edit-modal" className="fixed inset-0 z-[100] bg-white dark:bg-slate-900 sm:bg-slate-900/60 sm:backdrop-blur-sm flex items-center justify-center sm:p-4 overflow-hidden">
          <div className="w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 sm:border border-slate-200 dark:border-slate-800 sm:rounded-3xl sm:shadow-xl max-w-lg animation-fade-in text-slate-800 dark:text-slate-100 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Edit Profile</h2>
                <p className="text-xs text-slate-450 dark:text-slate-400">Update your health indicators and settings</p>
              </div>
              <div className="flex gap-2">
                <button
                  id="profile-save-btn"
                  onClick={handleSave}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
                >
                  {t.save}
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

              {/* Content scroll area */}
            <div className="p-6 overflow-y-auto space-y-4 text-left flex-1 pb-16">
              
              {/* Real Profile Photo Uploader */}
          <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800/80 rounded-2xl p-3.5">
            <div className="relative w-14 h-14 rounded-full overflow-hidden border-2 border-indigo-500/25 flex-shrink-0 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <img 
                src={profile.photoUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"} 
                alt="User profile" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Upload photo</span>
                <button
                  type="button"
                  id="edit-theme-link"
                  onClick={() => {
                    setIsEditing(false);
                    setShowThemeScreen(true);
                  }}
                  className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  edit theme
                </button>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      const base64String = reader.result as string;
                      const updated = { ...profile, photoUrl: base64String };
                      if (onSaveProfile) {
                        onSaveProfile(updated);
                      } else {
                        setProfile(updated);
                      }
                    };
                    reader.readAsDataURL(file);
                  }
                }}
                className="text-xs text-slate-500 dark:text-slate-400 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-indigo-50 file:text-indigo-600 dark:file:bg-indigo-950/40 dark:file:text-indigo-400 hover:file:bg-indigo-100/50 cursor-pointer w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.nicknameLabel}</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.ethnicity}</label>
              <select
                value={ethnicity}
                onChange={(e) => setEthnicity(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-850 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="Unknown">Unknown</option>
                <option value="Chinese">Chinese / East Asian</option>
                <option value="Caucasian">Caucasian</option>
                <option value="South Asian">South Asian</option>
                <option value="African American">African American / Black</option>
                <option value="Hispanic">Hispanic / Latino</option>
                <option value="Southeast Asian">Southeast Asian</option>
                <option value="Other">Mixed / Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.age}</label>
              <input
                type="number"
                value={age === 0 ? '' : age}
                onChange={(e) => setAge(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.weight} (kg)</label>
              <input
                type="number"
                value={weight === 0 ? '' : weight}
                onChange={(e) => setWeight(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.height} (cm)</label>
              <input
                type="number"
                value={height === 0 ? '' : height}
                onChange={(e) => setHeight(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Blood Type</label>
              <select
                value={bloodType}
                onChange={(e) => setBloodType(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="">Unknown</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Gender</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="Unknown">Unknown</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{formatTimezone(tz)}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800/80 rounded-xl px-3 py-2 mt-1 text-left">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Account Email</span>
              <span className="text-xs font-mono text-slate-650 dark:text-slate-300 break-all">{profile.email}</span>
            </div>

            {/* Preferences & Session */}
            <div className="col-span-2 border-t border-slate-100 dark:border-slate-800/85 mt-2 pt-3 text-left">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Google Health Integration</span>
              <GoogleHealthIntegration />
              
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4">Preferences & Session</span>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {/* Language Selection */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Language</label>
                  <select
                    id="lang-selector"
                    value={profile.language}
                    onChange={(e) => setProfile({ ...profile, language: e.target.value as any })}
                    className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value="en">English (EN)</option>
                    <option value="fr">Français (FR)</option>
                    <option value="zh">中文 (ZH)</option>
                    <option value="id">Bahasa Indonesia (ID)</option>
                  </select>
                </div>

                {/* Privacy mode toggle */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Privacy Mode</label>
                  <button
                    type="button"
                    id="toggle-sensitive-btn"
                    onClick={() => setHideSensitive(!hideSensitive)}
                    className="w-full flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-850 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-all cursor-pointer"
                  >
                    <span className="truncate">{hideSensitive ? t.sensitiveHidden : t.sensitiveShown}</span>
                    {hideSensitive ? <EyeOff className="w-4.5 h-4.5 text-rose-500 flex-shrink-0" /> : <Eye className="w-4.5 h-4.5 text-slate-400 flex-shrink-0" />}
                  </button>
                </div>
              </div>

              {/* Logout button */}
              <div className="mt-4 border-t border-slate-100 dark:border-slate-800/85 pt-3">
                <button
                  type="button"
                  id="signout-btn"
                  onClick={onSignOut}
                  className="w-full flex items-center justify-center gap-2 text-sm bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/30 border border-rose-100 dark:border-rose-900/30 rounded-xl px-3 py-2 text-rose-600 dark:text-rose-400 font-semibold transition-colors cursor-pointer"
                >
                  <LogOut className="w-4.5 h-4.5" />
                  <span>{t.signOut}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ), document.body)}

      {/* Dedicated full-screen or elegant modal Theme Customizer Screen */}
      {showThemeScreen && createPortal((
        <div id="theme-customizer-screen" className="fixed inset-0 z-[60] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animation-fade-in text-slate-800 dark:text-slate-100">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Theme & Accent Settings</h2>
                <p className="text-xs text-slate-450 dark:text-slate-400">Customize the typography and color styling of your portal</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (onSaveProfile) {
                      onSaveProfile(profile);
                    }
                    setShowThemeScreen(false);
                  }}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
                >
                  {t.save}
                </button>
                <button
                  onClick={() => setShowThemeScreen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Content scroll area */}
            <div className="p-6 overflow-y-auto space-y-6 text-left flex-1">
              {/* Theme Reset Button */}
              <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/40 border border-slate-150 dark:border-slate-800 rounded-2xl p-4">
                <div className="space-y-0.5 text-left pr-4">
                  <h4 className="text-sm font-bold text-slate-850 dark:text-slate-200">Reset Custom Theme</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Restore all application colors and typography back to defaults.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setProfile({
                    ...profile,
                    themePalette: {
                      button: '#4f46e5',
                      background: '#f8fafc',
                      border: '#e2e8f0',
                      warning: '#f43f5e',
                      caution: '#d97706',
                      success: '#059669',
                      text: '#1e293b',
                      textSecondary: '#64748b',
                      bgApp: '#f8fafc',
                      bgCard: '#ffffff',
                      neutralSetting: '#334155'
                    }
                  })}
                  className="px-4 py-2 bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm shrink-0"
                >
                  Reset Theme
                </button>
              </div>

              {/* Editable Color Pickers */}
              <div className="space-y-4">
                <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Fine-Tune Colors (All App Accents)</span>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ColorPickerField 
                    label="Buttons & Highlights" 
                    value={profile.themePalette?.button || '#4f46e5'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), button: v}})} 
                  />
                  <ColorPickerField 
                    label="App Background" 
                    value={profile.themePalette?.background || '#f8fafc'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), background: v, bgApp: v}})} 
                  />
                  <ColorPickerField 
                    label="Card & Containers" 
                    value={profile.themePalette?.bgCard || '#ffffff'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), bgCard: v}})} 
                  />
                  <ColorPickerField 
                    label="Borders & Dividers" 
                    value={profile.themePalette?.border || '#e2e8f0'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), border: v}})} 
                  />
                  <ColorPickerField 
                    label="Primary Text" 
                    value={profile.themePalette?.text || '#1e293b'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), text: v}})} 
                  />
                  <ColorPickerField 
                    label="Secondary Text" 
                    value={profile.themePalette?.textSecondary || '#64748b'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), textSecondary: v}})} 
                  />
                  <ColorPickerField 
                    label="Severe Warnings (Rose)" 
                    value={profile.themePalette?.warning || '#f43f5e'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), warning: v}})} 
                  />
                  <ColorPickerField 
                    label="Caution / Moderate (Amber)" 
                    value={profile.themePalette?.caution || '#d97706'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), caution: v}})} 
                  />
                  <ColorPickerField 
                    label="Success Highlights (Green)" 
                    value={profile.themePalette?.success || '#059669'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), success: v}})} 
                  />
                  <ColorPickerField 
                    label="Neutral Accents" 
                    value={profile.themePalette?.neutralSetting || '#334155'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), neutralSetting: v}})} 
                  />
                </div>
              </div>

              {/* Typography Customization */}
              <div className="space-y-4 border-t border-slate-100 dark:border-slate-800/80 pt-4">
                <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Application Typography</span>
                
                <div className="space-y-3">
                  {/* Typography Scales */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Title Size</label>
                      <select
                        value={profile.fontSizeTitle || 'normal'}
                        onChange={(e) => setProfile({ ...profile, fontSizeTitle: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                        <option value="xxl">2XL (24px)</option>
                        <option value="3xl">3XL (30px)</option>
                        <option value="4xl">4XL (36px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Subtitle Size</label>
                      <select
                        value={profile.fontSizeSubtitle || 'normal'}
                        onChange={(e) => setProfile({ ...profile, fontSizeSubtitle: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                        <option value="xxl">2XL (24px)</option>
                        <option value="3xl">3XL (30px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Body / Desc Size</label>
                      <select
                        value={profile.fontSizeDescription || 'normal'}
                        onChange={(e) => setProfile({ ...profile, fontSizeDescription: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                        <option value="xxl">2XL (24px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Body Small Size</label>
                      <select
                        value={profile.fontSizeBodySmall || 'small'}
                        onChange={(e) => setProfile({ ...profile, fontSizeBodySmall: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Subtitle Small Size</label>
                      <select
                        value={profile.fontSizeSubtitleSmall || 'small'}
                        onChange={(e) => setProfile({ ...profile, fontSizeSubtitleSmall: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Key Metric Size</label>
                      <select
                        value={profile.fontSizeKeyMetric || '4xl'}
                        onChange={(e) => setProfile({ ...profile, fontSizeKeyMetric: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                        <option value="xxl">2XL (24px)</option>
                        <option value="3xl">3xl (30px)</option>
                        <option value="4xl">4xl (36px)</option>
                        <option value="5xl">5xl (48px)</option>
                        <option value="6xl">6xl (60px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Smallest Size (XS)</label>
                      <select
                        value={profile.fontSizeXS || 'tiny'}
                        onChange={(e) => setProfile({ ...profile, fontSizeXS: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Body Standard Size</label>
                      <select
                        value={profile.fontSizeBody || 'normal'}
                        onChange={(e) => setProfile({ ...profile, fontSizeBody: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left col-span-2">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Base Root Size</label>
                      <select
                        value={profile.fontSize || 'normal'}
                        onChange={(e) => setProfile({ ...profile, fontSize: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                        <option value="xxl">2XL (24px)</option>
                      </select>
                    </div>
                  </div>

                  {/* Sans-Serif Font Family Dropdown */}
                  <div className="space-y-1 text-left">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Primary Font Face (Sans-Serif)</label>
                    <select
                      value={profile.fontFamily || 'Inter'}
                      onChange={(e) => setProfile({ ...profile, fontFamily: e.target.value })}
                      className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2.5 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                    >
                      <option value="Inter">Inter - Elegant Swiss utility</option>
                      <option value="Space Grotesk">Space Grotesk - Neo-brutalist display</option>
                      <option value="Outfit">Outfit - Warm geometric sans</option>
                      <option value="Playfair Display">Playfair Display - Elegant Editorial Serif</option>
                      <option value="Merriweather">Merriweather - Highly readable Serif</option>
                      <option value="system-ui">System UI - Fast default system native</option>
                    </select>
                  </div>

                  {/* Monospace Font Family Dropdown */}
                  <div className="space-y-1 text-left">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Technical Font Face (Monospace)</label>
                    <select
                      value={profile.fontMono || 'JetBrains Mono'}
                      onChange={(e) => setProfile({ ...profile, fontMono: e.target.value })}
                      className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2.5 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                    >
                      <option value="JetBrains Mono">JetBrains Mono - Clear code spacing</option>
                      <option value="Courier New">Courier New - Traditional Typewriter</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Live Preview Box */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-3xl p-4 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 space-y-4">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider text-left">Live Aesthetic Preview Sandbox</span>
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-4 text-left shadow-sm">
                  <div className="space-y-1">
                    <h4 className="text-lg font-bold font-display text-slate-900 dark:text-slate-100">Heading Title</h4>
                    <h5 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Subtitle Element</h5>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      This is secondary description text demonstrating typography scaling and color weight pairing. This helps visualize spacing and readability.
                    </p>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 text-xs font-semibold text-rose-500 bg-rose-50 dark:bg-rose-950/30 rounded-lg border border-rose-100 dark:border-rose-900/50">Severe Alert</span>
                    <span className="px-2 py-1 text-xs font-semibold text-amber-500 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-100 dark:border-amber-900/50">Moderate</span>
                    <span className="px-2 py-1 text-xs font-semibold text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-100 dark:border-emerald-900/50">Healthy</span>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-colors">
                      Secondary
                    </button>
                    <button className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors">
                      Primary Action
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* Database Interactions Live Sync Overlay */}
      {showDbInteractionsOverlay && createPortal((
        <div id="db-interactions-overlay" className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[80vh] animation-fade-in text-slate-850 dark:text-slate-100">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Live Database Operations</h2>
                  <span className="text-xs font-normal text-slate-400 block mt-0.5">
                    {(() => {
                      const buildTime = serverStartTime || 1782721085000;
                      const diffMs = Math.max(0, now - buildTime);
                      const diffMins = Math.floor(diffMs / 60000);
                      return diffMins < 1 ? 'last published just now' : `last published ${diffMins} min ago`;
                    })()}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {onCloudSync && (
                  <button
                    onClick={() => {
                      if (onCloudSync) onCloudSync();
                    }}
                    className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                    title="Manual Sync"
                  >
                    <RefreshCw className="w-4 h-4" /> Sync Now
                  </button>
                )}
                <button
                  onClick={() => setShowDbInteractionsOverlay(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Content area */}
            <div className="p-6 overflow-y-auto space-y-6 text-left flex-1">
              
              {/* Interaction statistics row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100/30 rounded-2xl relative overflow-hidden">
                  <div className="absolute inset-0 bg-indigo-600/5 dark:bg-indigo-400/5 w-full" style={{ width: `${Math.max(2, (dbInteractions.filter(i => i.type === 'upload' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / Math.max(1, dbInteractions.filter(i => i.type === 'upload').reduce((sum, i) => sum + i.sizeBytes, 0))) * 100)}%` }} />
                  <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Upload Pipeline</span>
                  <div className="flex items-end justify-between">
                    <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                      {(dbInteractions.filter(i => i.type === 'upload' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB
                    </span>
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 rounded relative z-10">
                      {dbInteractions.filter(i => i.type === 'upload' && i.status === 'pending').length} pending
                    </span>
                  </div>
                  <span className="block text-[10px] text-slate-500 mt-1.5 font-medium relative z-10 truncate">
                    <strong className="text-slate-700 dark:text-slate-300">{(dbInteractions.filter(i => i.type === 'upload' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB</strong> achieved / {(dbInteractions.filter(i => i.type === 'upload').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB needed
                  </span>
                </div>
                
                <div className="p-4 bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-100/30 rounded-2xl relative overflow-hidden">
                  <div className="absolute inset-0 bg-emerald-600/5 dark:bg-emerald-400/5 w-full" style={{ width: `${Math.max(2, (dbInteractions.filter(i => i.type === 'download' && i.status === 'completed').reduce((sum, i) => sum + (i.sizeBytes || 1024), 0) / Math.max(1, dbInteractions.filter(i => i.type === 'download').reduce((sum, i) => sum + (i.sizeBytes || 1024), 0))) * 100)}%` }} />
                  <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Download Pipeline</span>
                  <div className="flex items-end justify-between">
                    <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                      {(dbInteractions.filter(i => i.type === 'download' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB
                    </span>
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded relative z-10">
                      {dbInteractions.filter(i => i.type === 'download' && i.status === 'pending').length} pending
                    </span>
                  </div>
                  <span className="block text-[10px] text-slate-500 mt-1.5 font-medium relative z-10 truncate">
                    <strong className="text-slate-700 dark:text-slate-300">{(dbInteractions.filter(i => i.type === 'download' && i.status === 'completed').length)}</strong> achieved / {dbInteractions.filter(i => i.type === 'download').length} needed
                  </span>
                </div>
              </div>

              {/* Daily Quota row */}
              {quota && (
                <div className="space-y-2 mt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Firebase Quota Usage
                    </span>
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium">
                      Resets daily at 14:00 (WIB)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 bg-orange-50/40 dark:bg-orange-950/20 border border-orange-100/30 rounded-2xl relative overflow-hidden">
                      <div className="absolute inset-0 bg-orange-600/5 dark:bg-orange-400/5 w-full" style={{ width: `${Math.min(100, Math.max(2, (quota.reads / 50000) * 100))}%` }} />
                      <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Daily Reads (Free Tier)</span>
                      <div className="flex items-end justify-between">
                        <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                          {quota.reads.toLocaleString()} <span className="text-xs text-slate-500 font-sans">/ 50K</span>
                        </span>
                      </div>
                    </div>
                    
                    <div className="p-4 bg-rose-50/40 dark:bg-rose-950/20 border border-rose-100/30 rounded-2xl relative overflow-hidden">
                      <div className="absolute inset-0 bg-rose-600/5 dark:bg-rose-400/5 w-full" style={{ width: `${Math.min(100, Math.max(2, ((quota.writes + quota.deletes) / 40000) * 100))}%` }} />
                      <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Daily Writes/Deletes</span>
                      <div className="flex items-end justify-between">
                        <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                          {(quota.writes + quota.deletes).toLocaleString()} <span className="text-xs text-slate-500 font-sans">/ 40K</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Images Quota */}
              <div className="p-4 bg-blue-50/40 dark:bg-blue-950/20 border border-blue-100/30 rounded-2xl mt-4">
                <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Database Images (5GB Limit)</span>
                <div className="flex items-end justify-between">
                  <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                    {foodLogs.reduce((acc, log) => acc + (log.imageUrls?.length || 0) + (log.imageUrl ? 1 : 0), 0)} Images
                  </span>
                  <span className="text-xs font-bold text-blue-600 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded relative z-10">
                    {(foodLogs.reduce((acc, log) => acc + (log.imageUrl ? log.imageUrl.length : 0) + (log.imageUrls ? log.imageUrls.reduce((sum, img) => sum + img.length, 0) : 0), 0) / (1024 * 1024)).toFixed(2)} MB
                  </span>
                </div>
              </div>

              {/* AI Agent Live thinking / Debug Logs section */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-2xl mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider">
                      🔬 AI Agent Live thinking Process
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      View real-time LLM API handshakes & timeouts
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={debugMode}
                      onChange={(e) => handleToggleDebugMode(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-750 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {debugMode && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{debugLogs.length} events logged in this session</span>
                      <button 
                        onClick={handleClearDebugLogs}
                        className="px-2.5 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-xl text-[10px] font-bold text-slate-600 dark:text-slate-300 transition-colors"
                      >
                        Clear Logs
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowFullScreenDebugLogs(true)}
                      className="w-full py-3 bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 font-bold rounded-2xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:scale-[1.01]"
                    >
                      <span>🔍 Open Full-Screen Diagnostic Log Viewer</span>
                    </button>

                    <FullScreenLogViewer
                      isOpen={showFullScreenDebugLogs}
                      onClose={() => setShowFullScreenDebugLogs(false)}
                      title="AI Agent Diagnostic Log History"
                      logsText={debugLogs.map(l => `[${l.timestamp}] ${l.message}`).join('\n')}
                      onSendToAdmin={handleSendLogToAdmin}
                      isSendingLogs={isSendingLogs}
                      logsSendStatus={logsSendStatus}
                      onClearLogs={handleClearDebugLogs}
                      eventsCount={debugLogs.length}
                    />
                  </div>
                )}
              </div>

              {/* List of transactions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sync Transaction Activity Feed</span>
                  <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                    {dbInteractions.length} Total Logs
                  </span>
                </div>

                {dbInteractions.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-450 bg-slate-50 dark:bg-slate-850 rounded-2xl border border-dashed border-slate-250 dark:border-slate-800">
                    No active transactions logged in this session yet. Tapping sync or updating your records will populate this feed.
                  </div>
                ) : (
                  <div className="border border-slate-150 dark:border-slate-800/80 rounded-2xl overflow-hidden max-h-60 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-900 dark:bg-slate-950 border-b border-slate-800 text-[10px] font-bold text-white uppercase tracking-wider">
                          <th className="p-3">Time / Type</th>
                          <th className="p-3">Path & Payload</th>
                          <th className="p-3 text-right">Size</th>
                          <th className="p-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {dbInteractions.map((op) => (
                          <tr key={op.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20">
                            <td className="p-3">
                              <span className="block font-mono text-[10px] text-slate-400">{op.timestamp}</span>
                              <span className={`inline-block text-[9px] font-bold px-1.5 py-0.2 rounded-md ${
                                op.type === 'upload' ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/25 dark:text-blue-400' :
                                op.type === 'download' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/25 dark:text-emerald-400' :
                                op.type === 'delete' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/25 dark:text-rose-400' :
                                'bg-amber-50 text-amber-600 dark:bg-amber-950/25 dark:text-amber-400'
                              }`}>
                                {op.type.toUpperCase()}
                              </span>
                            </td>
                            <td className="p-3 font-mono text-[10px] max-w-[180px] truncate" title={op.path}>
                              {op.path}
                            </td>
                            <td className="p-3 text-right font-mono text-slate-650 dark:text-slate-350">
                              {op.sizeBytes > 0 ? `${op.sizeBytes} B` : '-'}
                            </td>
                            <td className="p-3 text-center">
                              <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                op.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' :
                                op.status === 'pending' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 animate-pulse' :
                                'bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400'
                              }`}>
                                {op.status} {op.status === 'pending' && op.startTimeMs ? `(${Math.floor((now - op.startTimeMs) / 1000)}s)` : ''}
                              </span>
                              {op.status === 'pending' && op.startTimeMs && now - op.startTimeMs > 5000 && (
                                <span className="block text-[9px] text-amber-600 dark:text-amber-500 mt-1" title="Waiting for server acknowledgment or offline sync queue">
                                  Waiting for connection...
                                </span>
                              )}
                              {op.errorMessage && (
                                <span className="block text-[9px] text-rose-500 mt-1 text-left max-w-[120px] truncate" title={op.errorMessage}>
                                  {op.errorMessage}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <button
                onClick={onCloudSync}
                className="px-4 py-2 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200/40 text-xs font-bold rounded-2xl hover:bg-indigo-100/50 cursor-pointer"
              >
                Force Pull Cloud Data
              </button>
              <button
                onClick={() => setShowDbInteractionsOverlay(false)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-2xl shadow-sm cursor-pointer transition-all"
              >
                Close Logs
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
