import { trackApiCall } from '../utils/apiTracker';
import { getAgentRequestLogs } from '../utils/agentLogsTracker';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { UserProfile, DbInteraction, QuotaData, FoodLog } from '../types';
import { translations } from '../utils/translations';
import { getAvailableCredits } from '../utils/creditManager';
import { NutrientPieChart } from './NutrientPieChart';
import {
  Eye, EyeOff, CloudLightning, CloudCheck, RefreshCw, LogOut, Check, ShieldCheck,
  Archive, FileSpreadsheet, KeyRound, Lock, Unlock, FileDown, FileUp, AlertTriangle,
  CloudUpload, CloudDownload, HelpCircle, Terminal, User, Cloud, Coins, Users, Copy, RotateCcw,
  Trash2
} from 'lucide-react';
import { db, auth } from '../firebase';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { lazyWithRetry } from '../utils/lazyWithRetry';
const GoogleHealthIntegration = lazyWithRetry(() => import('./GoogleHealthIntegration'));
const FullScreenLogViewer = lazyWithRetry(() => import('./FullScreenLogViewer'));
const ApiCallTrackerModal = lazyWithRetry(() => import('./ApiCallTrackerModal'));
const SyncDiagnosticsModal = lazyWithRetry(() => import('./SyncDiagnosticsModal'));
const DedupeBiomarkerLogsModal = lazyWithRetry(() => import('./DedupeBiomarkerLogsModal'));
const NutritionDataBrowserModal = lazyWithRetry(() => import('./NutritionDataBrowserModal'));
const BugTrackerModal = lazyWithRetry(() => import('./BugTrackerModal'));
import BugSnapshotFab, { BugSnapshotSettingsToggle } from './BugSnapshotFab';
const UserManagementTab = lazyWithRetry(() => import('./UserManagementTab'));
const BackupRestoreTab = lazyWithRetry(() => import('./BackupRestoreTab'));
const FoodCatalogAdminTab = lazyWithRetry(() => import('./FoodCatalogAdminTab').then(m => ({ default: m.FoodCatalogAdminTab })));
import { Activity, Stethoscope, X, ChevronRight, Database, Bug, Loader } from 'lucide-react';
import { JobStore } from '../jobs/JobStore';
import {
  getGoogleAccessToken,
  hasGoogleToken,
  runBackupWorkflow,
  listBackupsFromDrive,
  downloadFileFromDrive,
  previewBackupZip,
  restoreAccountToFirestore,
  clearGoogleToken
} from '../utils/googleBackup';
import { compressImage } from '../utils/imageCompressor';
import { checkQuotaFlag } from '../utils/firestoreUtils';
import { auditColors, auditFonts, auditDesignTokens, auditComponents, auditElements } from '../utils/themeRegistry';

export const parseColorAndOpacity = (val: string) => {
  let v = (val || '').trim();
  let hex6 = '#ffffff';
  let opacity = 100;

  if (v.startsWith('rgba(')) {
    const parts = v.replace('rgba(', '').replace(')', '').split(',').map(s => s.trim());
    if (parts.length >= 4) {
      const r = parseInt(parts[0], 10) || 0;
      const g = parseInt(parts[1], 10) || 0;
      const b = parseInt(parts[2], 10) || 0;
      const a = parseFloat(parts[3]);
      opacity = Math.round((isNaN(a) ? 1 : a) * 100);
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      hex6 = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
  } else if (v.startsWith('rgb(')) {
    const parts = v.replace('rgb(', '').replace(')', '').split(',').map(s => s.trim());
    if (parts.length >= 3) {
      const r = parseInt(parts[0], 10) || 0;
      const g = parseInt(parts[1], 10) || 0;
      const b = parseInt(parts[2], 10) || 0;
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      hex6 = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      opacity = 100;
    }
  } else if (v.startsWith('#')) {
    let clean = v.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map(c => c + c).join('');
    }
    if (clean.length === 8) {
      hex6 = '#' + clean.substring(0, 6);
      const alphaHex = clean.substring(6, 8);
      opacity = Math.round((parseInt(alphaHex, 16) / 255) * 100);
    } else if (clean.length === 6) {
      hex6 = '#' + clean;
      opacity = 100;
    }
  } else if (v) {
    hex6 = v;
  }

  return { hex6, opacity };
};

export const formatColorWithOpacity = (hex6: string, opacityPercent: number) => {
  let cleanHex = (hex6 || '#ffffff').trim();
  if (!cleanHex.startsWith('#')) cleanHex = '#' + cleanHex;
  let h = cleanHex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) h = 'ffffff';

  const opacity = Math.max(0, Math.min(100, opacityPercent));
  if (opacity >= 100) {
    return `#${h}`;
  }

  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  const a = (opacity / 100).toFixed(2).replace(/\.?0+$/, '');
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const ColorPickerField = ({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-2xl gap-2">
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
  setProfile: (p: UserProfile | ((prev: UserProfile) => UserProfile) | any) => void;
  onSaveProfile?: (p: UserProfile) => Promise<void>;
  hideSensitive: boolean;
  setHideSensitive: (h: boolean) => void;
  syncState: 'synced' | 'syncing' | 'local' | 'conflict';
  onSignOut: () => void;
  onCloudSync?: () => Promise<void>;
  onForcePush?: () => Promise<void>;
  /** Profile + biomarkers + all food logs (base64 images stripped). */
  onForcePushWithFoods?: () => Promise<void>;
  onForcePull?: () => Promise<void>;
  dbInteractions?: DbInteraction[];
  quota?: QuotaData;
  foodLogs?: FoodLog[];
  setFoodLogs?: (f: FoodLog[]) => void;
  biomarkerHistory?: any[];
  setBiomarkerHistory?: (b: any[]) => void;
  activeTab?: string;
  autoSyncDisabled?: boolean;
  onChangeAutoSyncDisabled?: (disabled: boolean) => void;
  biomarkers?: any;
  actions?: any[];
  dailyBenefits?: any[];
  report?: any;
  onSaveAndSync?: (profile: any, foodLogs: any[], biomarkers: any, biomarkerHistory: any[], actions: any[], dailyBenefits: any[], report: any, specificUpdate?: any) => Promise<void>;
  onOpenFrontDesk?: () => void;
  onOpenUndo?: () => void;
  onNavigateTab?: (tab: string) => void;
  /** Job currently open in the food/medical unified modal */
  viewingJobId?: string | null;
  onViewJob?: (jobId: string) => void;
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


const sizeMap: Record<string, string> = {
  tiny: '12px',
  small: '14px',
  normal: '16px',
  large: '18px',
  xl: '20px',
  xxl: '24px',
  '3xl': '30px',
  '4xl': '36px'
};

function CustomFontSelect({ 
  value, 
  options, 
  onChange, 
  isFamily = false 
}: { 
  value: string; 
  options: {value: string, label: string}[]; 
  onChange: (val: string) => void;
  isFamily?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  
  return (
    <>
      <button 
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-250 dark:border-slate-700 rounded-xl px-2 py-1.5 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer text-center relative flex justify-between items-center"
      >
        <span className="flex-1 text-center" style={{ fontFamily: isFamily ? value : undefined, fontSize: !isFamily ? sizeMap[value] : undefined }}>
           {isFamily ? value : (options.find(o => o.value === value)?.label.replace(' (', ' - ').replace(')', '') || value)}
        </span>
        <span className="text-[8px] opacity-50 ml-2">▼</span>
      </button>
      
      {isOpen && buttonRef.current && createPortal(
        <>
          <div id="font-select-overlay" className="fixed inset-0 z-[150]" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} />
          <div id="font-select-portal" 
            className="fixed z-[160] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-y-auto"
            style={{
              top: (buttonRef.current.getBoundingClientRect().bottom + 200 > window.innerHeight) ? undefined : buttonRef.current.getBoundingClientRect().bottom + 4,
              bottom: (buttonRef.current.getBoundingClientRect().bottom + 200 > window.innerHeight) ? window.innerHeight - buttonRef.current.getBoundingClientRect().top + 4 : undefined,
              left: buttonRef.current.getBoundingClientRect().left,
              width: buttonRef.current.getBoundingClientRect().width,
              maxHeight: '200px'
            }}
          >
            {options.map(opt => (
              <div 
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                style={{
                  fontFamily: isFamily ? opt.value : undefined,
                  fontSize: !isFamily ? sizeMap[opt.value] : undefined,
                }}
                className={`px-3 py-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 ${value === opt.value ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold' : 'text-slate-700 dark:text-slate-300'}`}
              >
                {isFamily ? opt.label : opt.label.replace(' (', ' - ').replace(')', '')}
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}
export default function Header({
  profile,
  setProfile,
  onSaveProfile,
  hideSensitive,
  setHideSensitive,
  syncState,
  onSignOut,
  onCloudSync,
  onForcePush,
  onForcePushWithFoods,
  onForcePull,
  dbInteractions = [],
  quota,
  foodLogs = [],
  setFoodLogs,
  biomarkerHistory = [],
  setBiomarkerHistory,
  activeTab = 'home',
  autoSyncDisabled = false,
  onChangeAutoSyncDisabled,
  biomarkers,
  actions,
  dailyBenefits,
  report,
  onSaveAndSync,
  onOpenFrontDesk,
  onOpenUndo,
  onNavigateTab,
  viewingJobId = null,
  onViewJob,
}: HeaderProps) {
  const [jobs, setJobs] = useState(() => JobStore.getAllJobs());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = JobStore.subscribe(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => setJobs(JobStore.getAllJobs()), 400);
    });
    return () => {
      unsubscribe();
      if (t) clearTimeout(t);
    };
  }, []);

  const [isEditing, setIsEditing] = useState(false);
  const [showThemeScreen, setShowThemeScreen] = useState(false);
  const [themePreviewMode, setThemePreviewMode] = useState(false);
  const [themeCompactMode, setThemeCompactMode] = useState(false);
  
  const [themeActiveSection, setThemeActiveSection] = useState<'colors' | 'fonts' | 'tokens' | 'components' | 'elements' | 'presets'>('colors');
  const [expandedColorKey, setExpandedColorKey] = useState<string | null>(null);
  const [colorDraft, setColorDraft] = useState<{ key: string; label: string; value: string } | null>(null);
  const [textPreviewOverride, setTextPreviewOverride] = useState<Record<string, 'light' | 'dark'>>({});
  const [justSavedKey, setJustSavedKey] = useState<string | null>(null);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [inspectedElement, setInspectedElement] = useState<any>(null);
  const [inspectorPaused, setInspectorPaused] = useState(false);
  const [inspectorProperty, setInspectorProperty] = useState('color');
  const [inspectorVariable, setInspectorVariable] = useState('');

  const initialThemeSnapshot = useRef<any>(null);
  const colorOriginalVal = useRef<Record<string, string>>({});

  useEffect(() => {
    if (showThemeScreen) {
      setThemePreviewMode(true);
      setInspectorPaused(false);

      initialThemeSnapshot.current = JSON.parse(JSON.stringify({
        themePalette: profile.themePalette,
        customColors: profile.customColors,
        customFonts: profile.customFonts,
        fontSize: profile.fontSize,
        fontFamily: profile.fontFamily,
        fontMono: profile.fontMono,
        fontSizeTitle: profile.fontSizeTitle,
        fontSizeSubtitle: profile.fontSizeSubtitle,
        fontSizeDescription: profile.fontSizeDescription,
        fontSizeBodySmall: profile.fontSizeBodySmall,
        fontSizeSubtitleSmall: profile.fontSizeSubtitleSmall,
        fontSizeKeyMetric: profile.fontSizeKeyMetric,
        fontSizeXS: profile.fontSizeXS,
        fontSizeBody: profile.fontSizeBody,
        marginScale: profile.marginScale,
        paddingScale: profile.paddingScale,
        cornerRadius: profile.cornerRadius,
        shadowScale: profile.shadowScale,
        themeOverrides: profile.themeOverrides
      }));
    } else {
      if (initialThemeSnapshot.current) {
        setProfile(prev => ({
          ...prev,
          ...initialThemeSnapshot.current
        }));
        initialThemeSnapshot.current = null;
      }
      setThemePreviewMode(false);
      revertPreview();
      setInspectedElement(null);
    }
  }, [showThemeScreen]);
  const [showDbInteractionsOverlay, setShowDbInteractionsOverlay] = useState(false);
  const [selectedSyncCategory, setSelectedSyncCategory] = useState<'food' | 'biomarker' | 'core' | null>(null);
  const [catalogSyncStatus, setCatalogSyncStatus] = useState<any>(null);

  useEffect(() => {
    if (showDbInteractionsOverlay) {
      fetch('/api/admin/food-catalog-sync-status')
        .then(res => res.ok ? res.json() : null)
        .then(data => data && setCatalogSyncStatus(data))
        .catch(() => {});
    }
  }, [showDbInteractionsOverlay]);
  const [dbOverlayViewMode, setDbOverlayViewMode] = useState<'admin' | 'user'>(() => {
    if (profile?.email?.toLowerCase().trim() !== 'cwah.liu@gmail.com') return 'user';
    const saved = localStorage.getItem('health_cockpit_admin_mode');
    if (saved) return saved as 'admin' | 'user';
    return 'admin';
  });
  const [activeAdminTab, setActiveAdminTab] = useState<'sync' | 'users' | 'backup' | 'catalog'>('sync');
  const [showAgentLogs, setShowAgentLogs] = useState(false);
  const [showApiTracker, setShowApiTracker] = useState(false);
  const [showNutritionDataBrowser, setShowNutritionDataBrowser] = useState(false);
  const [showBugTracker, setShowBugTracker] = useState(false);
  const [showSyncDiagnostics, setShowSyncDiagnostics] = useState(false);
  const [showDedupeBiomarkerLogs, setShowDedupeBiomarkerLogs] = useState(false);
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);
  const [agentLogs, setAgentLogs] = useState<{ timestamp: string, message: string }[]>([]);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);
  const [nickname, setNickname] = useState(profile.nickname);
  const [age, setAge] = useState<number | string>(profile.age);
  const [ethnicity, setEthnicity] = useState(profile.ethnicity);
  const [weight, setWeight] = useState<number | string>(profile.weight);
  const [height, setHeight] = useState<number | string>(profile.height);
  const [bloodType, setBloodType] = useState<string>(profile.bloodType || '');
  const [gender, setGender] = useState<string>(profile.gender || 'Unknown');
  const [unitPreference, setUnitPreference] = useState<string>(profile.unitPreference || 'SI');
  const [timezone, setTimezone] = useState<string>(profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [now, setNow] = useState(Date.now());
  const t = translations[profile.language] || translations.en;

  const handleToggleAutoSync = (disabled: boolean) => {
    if (onChangeAutoSyncDisabled) {
      onChangeAutoSyncDisabled(disabled);
    }
  };

  
  useEffect(() => {
    if (!themePreviewMode) {
      revertPreview();
      setInspectedElement(null);
      return;
    }
    const handler = (e: MouseEvent) => {
      if ((e.target as Element).closest('#theme-customizer-screen') || (e.target as Element).closest('#font-select-portal') || (e.target as Element).closest('#font-select-overlay')) {
        revertPreview();
        setInspectedElement(null);
        return;
      }
      if ((e.target as Element).closest('#inspector-popup')) return;
      if (inspectorPaused) return; // let the click through untouched
      e.preventDefault();
      e.stopPropagation();
      
      revertPreview();

      const el = e.target as HTMLElement;
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector = '#' + el.id;
      } else if (el.className && typeof el.className === 'string') {
        const cls = el.className.split(' ').map(c => c.trim()).filter(c => c && !c.includes(':') && !c.includes('/') && !c.includes('[') && !c.includes('!')).join('.');
        if (cls) selector += '.' + cls;
      }
      
      setInspectedElement({
        el,
        selector,
        rect: el.getBoundingClientRect(),
        text: el.innerText ? el.innerText.substring(0, 20) : 'Element'
      });
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [themePreviewMode, inspectorPaused]);

  // Handle saving overrides
  const saveOverride = () => {
    if (!inspectedElement || !inspectorVariable) return;
    const existingOverrides = profile.themeOverrides || [];
    const filteredOverrides = existingOverrides.filter(
      (o: any) => !(o.selector === inspectedElement.selector && o.property === inspectorProperty)
    );
    const newOverrides = [...filteredOverrides, {
      selector: inspectedElement.selector,
      property: inspectorProperty,
      variable: inspectorVariable
    }];
    setProfile({ ...profile, themeOverrides: newOverrides });
    inspectorOriginalValue.current = null;
    setInspectedElement(null);
  };

  // Dynamic color/font registry helpers
  const handleRenameColor = (key: string, newLabel: string) => {
    const currentList = [...(profile.customColors || auditColors)];
    const updatedList = currentList.map((c: any) => c.key === key ? { ...c, label: newLabel } : c);
    setProfile({ ...profile, customColors: updatedList });
  };

  const handleDeleteColor = (key: string) => {
    const currentList = [...(profile.customColors || auditColors)];
    const updatedList = currentList.filter((c: any) => c.key !== key);
    // Also remove from themePalette if present
    const nextPalette = { ...(profile.themePalette || {}) };
    delete (nextPalette as any)[key];
    setProfile({ ...profile, customColors: updatedList, themePalette: nextPalette });
  };

  const handleAddColor = (category: 'general' | 'text' | 'status' | 'nutrients') => {
    const currentList = [...(profile.customColors || auditColors)];
    const newKey = `custom_${Date.now()}`;
    const newColor = {
      key: newKey,
      label: 'New ' + (category === 'general' ? 'General' : category === 'text' ? 'Text' : category === 'status' ? 'Status' : 'Nutrients') + ' Color',
      description: 'Custom added color variable',
      defaultHex: '#3b82f6',
      tailwindVar: '',
      category: category
    };
    const updatedList = [...currentList, newColor];
    const nextPalette = { ...(profile.themePalette || {}) };
    (nextPalette as any)[newKey] = '#3b82f6'; // set default color value
    setProfile({ ...profile, customColors: updatedList, themePalette: nextPalette });
  };

  const handleRenameFont = (key: string, newLabel: string) => {
    const currentList = [...(profile.customFonts || auditFonts)];
    const updatedList = currentList.map((f: any) => f.key === key ? { ...f, label: newLabel } : f);
    setProfile({ ...profile, customFonts: updatedList });
  };

  const THEME_CATEGORY_SECTION_LABELS: Record<string, string> = {
    general: 'General colours',
    text: 'Text colour',
    status: 'Status',
    nutrients: 'Nutrients & Targets'
  };

  const buildExportPayload = (presetConfig: any, presetName: string) => {
    const colorsSource = profile.customColors || auditColors;
    const fontsSource = profile.customFonts || auditFonts;
    const palette = presetConfig?.themePalette || {};

    const colours: Record<string, Record<string, string>> = {};
    colorsSource.forEach((c: any) => {
      let sectionLabel = THEME_CATEGORY_SECTION_LABELS[c.category];
      if (c.category === 'text' || ['text', 'textSecondary', 'textDarkPrimary', 'textDarkSecondary', 'textAccent', 'textMuted', 'textSuccess', 'textError'].includes(c.key)) {
        const getEffectiveGroupForColor = (col: any) => {
          if (textPreviewOverride[col.key]) return textPreviewOverride[col.key];
          if (col.key === 'textDarkPrimary' || col.key === 'textDarkSecondary') return 'dark';
          if (col.key === 'text' || col.key === 'textSecondary' || col.key === 'textAccent' || col.key === 'textMuted' || col.key === 'textSuccess' || col.key === 'textError') return 'light';
          return col.darkGroup || 'light';
        };
        const mode = getEffectiveGroupForColor(c);
        sectionLabel = mode === 'dark' ? 'Text colour: Text over dark' : 'Text colour: Text over light';
      }
      if (!sectionLabel) sectionLabel = 'Other colours';
      if (!colours[sectionLabel]) colours[sectionLabel] = {};
      const value = palette[c.key] !== undefined ? palette[c.key] : c.defaultHex;
      const displayName = c.key?.startsWith('custom_') ? `${c.label} (custom)` : c.label;
      colours[sectionLabel][displayName] = value;
    });

    const fonts: Record<string, any> = {};
    fontsSource.forEach((f: any) => {
      const currentVal = presetConfig?.[f.fontSizeKey] || 'normal';
      const currentOption = (f.options || []).find((o: any) => o.value === currentVal);
      const scale: Record<string, string> = {};
      (f.options || []).forEach((o: any) => { scale[o.value] = o.label; });
      const displayName = f.key?.startsWith('custom_') ? `${f.label} (custom)` : f.label;
      fonts[displayName] = {
        current: currentOption ? currentOption.label : currentVal,
        scale
      };
    });
    fonts['Sans Font'] = { current: presetConfig?.fontFamily || 'Inter', scale: null };
    fonts['Mono Font'] = { current: presetConfig?.fontMono || 'JetBrains Mono', scale: null };

    const tokens: Record<string, any> = {};
    auditDesignTokens.forEach((t) => {
      const currentVal = presetConfig?.[t.tokenKey] || t.defaultValue;
      const currentOption = (t.options || []).find((o) => o.value === currentVal);
      const scale: Record<string, string> = {};
      (t.options || []).forEach((o) => { scale[o.value] = o.label; });
      tokens[t.label] = {
        current: currentOption ? currentOption.label : currentVal,
        scale
      };
    });

    return {
      _meta: {
        format: 'health-tracker-3-theme-preset',
        version: 2,
        note: "Every colour, font, and layout token below is listed by its current display name (including custom renames) and computed value, grouped into the same sections shown in this app's theme editor. To import, match each name to the corresponding variable in the theme editor and apply its value."
      },
      preset: {
        name: presetName,
        colours,
        fonts,
        tokens,
        themeOverrides: presetConfig?.themeOverrides
      }
    };
  };

  const normalizeImportedPreset = (rawInput: any) => {
    if (!rawInput) return null;
    let rawPreset = rawInput.preset && typeof rawInput.preset === 'object' && !Array.isArray(rawInput.preset) ? rawInput.preset : rawInput;

    const name = rawPreset.name || 'Imported Preset';
    const themePalette = rawPreset.themePalette ? { ...rawPreset.themePalette } : {};
    let fontFamily = rawPreset.fontFamily || 'Inter';
    let fontMono = rawPreset.fontMono || 'JetBrains Mono';
    const themeOverrides = rawPreset.themeOverrides || [];

    const presetResult: any = {
      ...rawPreset,
      name,
      themePalette,
      fontFamily,
      fontMono,
      themeOverrides
    };

    if (rawPreset.colours && typeof rawPreset.colours === 'object') {
      const colorsSource = profile.customColors || auditColors;
      Object.entries(rawPreset.colours).forEach(([sectionName, section]: [string, any]) => {
        if (section && typeof section === 'object') {
          Object.entries(section).forEach(([displayName, hexVal]: [string, any]) => {
            if (typeof hexVal === 'string') {
              const cleanName = displayName.replace(' (custom)', '').replace(/_/g, ' ').trim();
              
              let match = colorsSource.find((c: any) => 
                c.label === cleanName || 
                c.label === displayName || 
                c.key === cleanName || 
                c.key === displayName ||
                c.key.toLowerCase() === displayName.toLowerCase().replace(/_/g, '') ||
                c.key.toLowerCase() === displayName.toLowerCase().replace(/_/g, ' ')
              );

              if (!match) {
                match = auditColors.find((c: any) => 
                  c.label === cleanName || 
                  c.label === displayName || 
                  c.key === cleanName || 
                  c.key === displayName ||
                  c.key.toLowerCase() === displayName.toLowerCase().replace(/_/g, '') ||
                  c.key.toLowerCase() === displayName.toLowerCase().replace(/_/g, ' ')
                );
              }

              if (!match) {
                const lower = cleanName.toLowerCase();
                const lowerSection = (sectionName || '').toLowerCase();
                let keyMatch: string | null = null;

                if (lower.includes('primary text over dark') || (lowerSection.includes('over dark') && lower.includes('primary'))) keyMatch = 'textDarkPrimary';
                else if (lower.includes('secondary text over dark') || (lowerSection.includes('over dark') && lower.includes('secondary'))) keyMatch = 'textDarkSecondary';
                else if (lower.includes('primary text') || lower === 'primary text over light') keyMatch = 'text';
                else if (lower.includes('secondary text') || lower === 'secondary text light') keyMatch = 'textSecondary';
                else if (lower.includes('highlight text') || lower.includes('accent highlight')) keyMatch = 'textAccent';
                else if (lower.includes('muted hint') || lower.includes('muted')) keyMatch = 'textMuted';
                else if (lower.includes('success text')) keyMatch = 'textSuccess';
                else if (lower.includes('critical alert') || lower.includes('critical text') || lower.includes('error text')) keyMatch = 'textError';
                else if (lower.includes('buttons') || lower.includes('button')) keyMatch = 'button';
                else if (lower.includes('app background') || lower.includes('background')) keyMatch = 'background';
                else if (lower.includes('card') || lower.includes('container')) keyMatch = 'bgCard';
                else if (lower.includes('border') || lower.includes('divider')) keyMatch = 'border';
                else if (lower.includes('neutral setting') || lower.includes('neutral')) keyMatch = 'neutralSetting';
                else if (lower.includes('severe warning') || lower.includes('warning') || lower.includes('rose')) keyMatch = 'warning';
                else if (lower.includes('caution') || lower.includes('amber')) keyMatch = 'caution';
                else if (lower.includes('success highlight') || lower.includes('success')) keyMatch = 'success';
                else if (lower.includes('information') || lower.includes('info') || lower.includes('blue')) keyMatch = 'info';
                else if (lower.includes('calories')) keyMatch = 'nutrientCalories';
                else if (lower.includes('protein')) keyMatch = 'nutrientProtein';
                else if (lower.includes('carbs') || lower.includes('carbohydrate')) keyMatch = 'nutrientCarbs';
                else if (lower.includes('sat. fat') || lower.includes('saturated fat') || lower.includes('sat fat')) keyMatch = 'nutrientSatFat';
                else if (lower.includes('fat')) keyMatch = 'nutrientFat';
                else if (lower.includes('sodium')) keyMatch = 'nutrientSodium';

                if (keyMatch) {
                  match = auditColors.find((c: any) => c.key === keyMatch);
                }
              }

              if (match) {
                themePalette[match.key] = hexVal;
              }
            }
          });
        }
      });
      presetResult.themePalette = themePalette;
    }

    if (rawPreset.fonts && typeof rawPreset.fonts === 'object') {
      const fontsSource = profile.customFonts || auditFonts;
      Object.entries(rawPreset.fonts).forEach(([displayName, fontData]: [string, any]) => {
        if (displayName === 'Sans Font' && (fontData?.current || typeof fontData === 'string')) {
          presetResult.fontFamily = fontData.current || fontData;
        } else if (displayName === 'Mono Font' && (fontData?.current || typeof fontData === 'string')) {
          presetResult.fontMono = fontData.current || fontData;
        } else if (fontData) {
          const cleanName = displayName.replace(' (custom)', '').trim();
          let match = fontsSource.find((f: any) => f.label === cleanName || f.label === displayName || f.key === cleanName);
          if (!match) {
            match = auditFonts.find((f: any) => f.label === cleanName || f.label === displayName || f.key === cleanName);
          }
          if (!match) {
            const lower = cleanName.toLowerCase();
            if (lower.includes('base root') || lower.includes('root font')) match = auditFonts.find(f => f.key === 'fontSize');
            else if (lower.includes('heading') || lower.includes('title font')) match = auditFonts.find(f => f.key === 'fontSizeTitle');
            else if (lower.includes('subtitle font')) match = auditFonts.find(f => f.key === 'fontSizeSubtitle');
            else if (lower.includes('standard body') || lower.includes('body font')) match = auditFonts.find(f => f.key === 'fontSizeBody');
            else if (lower.includes('supporting') || lower.includes('caption font')) match = auditFonts.find(f => f.key === 'fontSizeBodySmall');
            else if (lower.includes('small section') || lower.includes('tag font')) match = auditFonts.find(f => f.key === 'fontSizeSubtitleSmall');
            else if (lower.includes('key metric')) match = auditFonts.find(f => f.key === 'fontSizeKeyMetric');
            else if (lower.includes('micro') || lower.includes('label font')) match = auditFonts.find(f => f.key === 'fontSizeXS');
          }

          if (match) {
            const val = fontData.current || fontData;
            const optMatch = (match.options || []).find((o: any) => 
              o.label === val || 
              o.value === val || 
              (typeof val === 'string' && (
                o.label.toLowerCase() === val.toLowerCase() ||
                o.value.toLowerCase() === val.toLowerCase() ||
                o.label.toLowerCase().includes(val.toLowerCase()) ||
                val.toLowerCase().includes(o.value.toLowerCase())
              ))
            );
            presetResult[match.fontSizeKey] = optMatch ? optMatch.value : val;
          }
        }
      });
    }

    if (rawPreset.tokens && typeof rawPreset.tokens === 'object') {
      Object.entries(rawPreset.tokens).forEach(([tokenLabel, tokenData]: [string, any]) => {
        let match = auditDesignTokens.find(t => t.label === tokenLabel || t.key === tokenLabel);
        if (!match) {
          const lower = tokenLabel.toLowerCase();
          if (lower.includes('margin')) match = auditDesignTokens.find(t => t.tokenKey === 'marginScale');
          else if (lower.includes('padding')) match = auditDesignTokens.find(t => t.tokenKey === 'paddingScale');
          else if (lower.includes('corner') || lower.includes('rounding')) match = auditDesignTokens.find(t => t.tokenKey === 'cornerRadius');
          else if (lower.includes('shadow')) match = auditDesignTokens.find(t => t.tokenKey === 'shadowScale');
        }

        if (match && tokenData) {
          const val = tokenData.current || tokenData;
          const optMatch = (match.options || []).find(o => 
            o.label === val || 
            o.value === val || 
            (typeof val === 'string' && (
              o.label.toLowerCase() === val.toLowerCase() ||
              o.value.toLowerCase() === val.toLowerCase() ||
              o.label.toLowerCase().includes(val.toLowerCase()) ||
              val.toLowerCase().includes(o.value.toLowerCase())
            ))
          );
          presetResult[match.tokenKey] = optMatch ? optMatch.value : val;
        }
      });
    }

    return presetResult;
  };

  const PRESET_COMPARE_KEYS = ['themePalette', 'fontFamily', 'fontMono', 'fontSize', 'marginScale', 'paddingScale', 'cornerRadius', 'shadowScale', 'themeOverrides', 'customColors', 'fontSizeTitle', 'fontSizeSubtitle', 'fontSizeDescription', 'fontSizeBodySmall', 'fontSizeSubtitleSmall', 'fontSizeKeyMetric', 'fontSizeXS', 'fontSizeBody', 'customFonts'];

  const normalizePresetValue = (v: any) => {
    if (v === undefined || v === null) return null;
    if (Array.isArray(v) && v.length === 0) return null;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return null;
    return v;
  };

  const deepEqual = (a: any, b: any): boolean => {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === 'object') {
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      if (aKeys.length !== bKeys.length) return false;
      return aKeys.every(k => deepEqual(a[k], b[k]));
    }
    return false;
  };

  const isPresetActive = (presetConfig: any) => {
    if (!presetConfig) return false;
    return PRESET_COMPARE_KEYS.every(k =>
      deepEqual(normalizePresetValue((profile as any)[k]), normalizePresetValue((presetConfig as any)[k]))
    );
  };

  const applyPresetConfig = (presetConfig: any) => {
    const updatedP = { ...profile };
    PRESET_COMPARE_KEYS.forEach(k => {
      if (presetConfig && presetConfig[k] !== undefined && presetConfig[k] !== null) {
        updatedP[k] = presetConfig[k];
      } else {
        updatedP[k] = k === 'themeOverrides' ? [] : null;
      }
    });
    
    // Critical fix: Ensure local profile is unmistakably newer than the cloud profile
    // to prevent aggressive remote-sync from reverting the theme immediately after applying.
    updatedP.lastUpdatedAt = Date.now();
    sessionStorage.setItem('localThemeOverridesCloud', 'true');

    setProfile(updatedP);
    if (initialThemeSnapshot.current) {
      initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
    }
    if (onSaveProfile) onSaveProfile(updatedP);
  };

  const getThemeVariableChangesCount = () => {
    let count = profile.themeOverrides?.length || 0;
    
    // Track customized values in themePalette compared to defaults
    if (profile.themePalette) {
      Object.entries(profile.themePalette).forEach(([key, val]) => {
        const defaultColor = auditColors.find((c: any) => c.key === key);
        if (defaultColor && val && defaultColor.defaultHex !== val) {
          count++;
        }
      });
    }

    const currentColors = profile.customColors || auditColors;
    currentColors.forEach((color: any) => {
      const defaultColor = auditColors.find((c: any) => c.key === color.key);
      if (defaultColor) {
        if (defaultColor.label !== color.label) {
          count++;
        }
      } else {
        count++; // New color added
      }
    });

    // Also count any deleted default colors
    auditColors.forEach((dc: any) => {
      const stillExists = currentColors.some((c: any) => c.key === dc.key);
      if (!stillExists) {
        count++;
      }
    });

    const currentFonts = profile.customFonts || auditFonts;
    currentFonts.forEach((font: any) => {
      const defaultFont = auditFonts.find((f: any) => f.key === font.key);
      if (defaultFont) {
        if (defaultFont.label !== font.label) {
          count++;
        }
      } else {
        count++; // New font added
      }
    });

    return count;
  };

  const colorsList = profile.customColors || auditColors;
  const fontsList = profile.customFonts || auditFonts;

  const getColorVariable = (key: string) => {
    const map: Record<string, string> = {
      button: '--color-indigo-500',
      background: '--app-bg',
      bgCard: '--app-bg-card',
      border: '--app-border',
      text: '--app-text',
      textSecondary: '--app-text-secondary',
      textAccent: '--color-text-accent',
      textMuted: '--color-text-muted',
      warning: '--color-rose-500',
      caution: '--color-amber-500',
      success: '--color-emerald-500',
      info: '--color-blue-500',
      neutralSetting: '--app-neutral',
      nutrientCalories: '--color-nutrient-calories',
      nutrientProtein: '--color-nutrient-protein',
      nutrientCarbs: '--color-nutrient-carbohydrates',
      nutrientFat: '--color-nutrient-totalFat',
      nutrientSatFat: '--color-nutrient-saturatedFat',
      nutrientSodium: '--color-nutrient-sodium'
    };
    return map[key] || `--color-${key}`;
  };

  const detectCurrentVariable = (el: HTMLElement, property: string) => {
    const cssProp = property === 'color' ? 'color' : property === 'background-color' ? 'backgroundColor' : property === 'border-color' ? 'borderColor' : null;
    if (!cssProp) return '';
    const currentValue = getComputedStyle(el)[cssProp as any];
    const probe = document.createElement('div');
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    document.body.appendChild(probe);
    let matched = '';
    for (const color of colorsList) {
      (probe.style as any)[cssProp] = `var(${getColorVariable(color.key)})`;
      if (getComputedStyle(probe)[cssProp as any] === currentValue) {
        matched = `var(${getColorVariable(color.key)})`;
        break;
      }
    }
    document.body.removeChild(probe);
    return matched;
  };

  useEffect(() => {
    if (inspectedElement?.el) {
      setInspectorVariable(detectCurrentVariable(inspectedElement.el, inspectorProperty));
    }
  }, [inspectedElement, inspectorProperty]);

  const inspectorOriginalValue = useRef<{ el: HTMLElement; property: string; value: string } | null>(null);

  const applyPreview = (variable: string, property: string, el: HTMLElement) => {
    const cssPropMap: Record<string, string> = {
      'color': 'color',
      'background-color': 'backgroundColor',
      'border-color': 'borderColor',
      'font-family': 'fontFamily',
      'font-size': 'fontSize'
    };
    const cssProp = cssPropMap[property];
    if (!cssProp) return;

    if (!inspectorOriginalValue.current || inspectorOriginalValue.current.el !== el || inspectorOriginalValue.current.property !== cssProp) {
      if (inspectorOriginalValue.current) {
        revertPreview();
      }
      inspectorOriginalValue.current = {
        el,
        property: cssProp,
        value: (el.style as any)[cssProp] || ''
      };
    }
    (el.style as any)[cssProp] = variable ? variable : '';
  };

  const revertPreview = () => {
    if (inspectorOriginalValue.current) {
      const { el, property, value } = inspectorOriginalValue.current;
      if (el && property) {
        (el.style as any)[property] = value;
      }
    }
    inspectorOriginalValue.current = null;
  };

  const getFontVariable = (key: string) => {
    const map: Record<string, string> = {
      fontSize: '--font-size',
      fontSizeTitle: '--font-size-title',
      fontSizeSubtitle: '--font-size-subtitle',
      fontSizeSubtitleSmall: '--font-size-subtitle-small',
      fontSizeBody: '--font-size-body',
      fontSizeBodySmall: '--font-size-body-small',
      fontSizeKeyMetric: '--font-size-key-metric',
      fontSizeXS: '--font-size-xs'
    };
    return map[key] || `--font-size-${key.toLowerCase()}`;
  };

  // Derives a human-readable content label from a raw sync interaction path,
  // e.g. "users/abc123 (Actions)" -> "Actions", "users/abc123/reports/latest" -> "Report".
  // Display-only helper: does not affect any sync/write logic.
  const getSyncLabel = (path: string): string => {
    const parenMatch = path.match(/\(([^)]+)\)\s*$/);
    if (parenMatch) return parenMatch[1];
    const segments = path.split('/').filter(Boolean);
    const collectionMap: Record<string, string> = {
      foodLogs: 'Food Log',
      biomarkerHistory: 'Biomarker',
      reports: 'Report',
      agentAnalyses: 'Analysis',
      foodImages: 'Food Image',
      metadata: 'Dashboard'
    };
    for (let i = segments.length - 1; i >= 0; i--) {
      if (collectionMap[segments[i]]) return collectionMap[segments[i]];
    }
    return 'Profile / Full Sync';
  };

  const handleCopySyncFeed = async () => {
    const text = dbInteractions.map(op =>
      `[${op.timestamp}] ${op.type.toUpperCase()} | ${op.database === 'Supabase' ? 'Supabase' : 'Firebase'} | ${getSyncLabel(op.path)} | ${op.path} | ${op.sizeBytes > 0 ? op.sizeBytes + ' B' : '-'} | ${op.status}${op.errorMessage ? ' | Error: ' + op.errorMessage : ''}`
    ).join('\n');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
    } catch (e) {
      console.error('Failed to copy sync feed:', e);
    }
  };

  useEffect(() => {
    if (!showAgentLogs) return;
    // Read from localStorage immediately on open — no polling needed
    const readLocalLogs = () => {
      const saved = getAgentRequestLogs();
      if (Array.isArray(saved) && saved.length > 0) {
        const flat = saved.flatMap((req: any) =>
          Array.isArray(req.logs)
            ? req.logs.map((l: any) => ({ timestamp: l.timestamp || req.timestamp, message: l.message }))
            : [{ timestamp: req.timestamp, message: req.summary || JSON.stringify(req) }]
        );
        if (flat.length > 0) { setAgentLogs(flat); return; }
      }
      // Fallback: one-shot server fetch (no polling interval)
      fetch('/api/gemini/debug-logs', { headers: { 'X-Session-ID': 'global' } })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (data?.logs) setAgentLogs(data.logs); })
        .catch(() => {});
    };
    readLocalLogs();
    // Re-read whenever new logs are saved (event fired inside saveAgentRequestLog)
    window.addEventListener('agent_logs_updated', readLocalLogs);
    return () => window.removeEventListener('agent_logs_updated', readLocalLogs);
  }, [showAgentLogs]);

  const handleClearAgentLogs = async () => {
    try {
      await fetch('/api/gemini/clear-debug-logs', { method: 'POST', headers: { 'X-Session-ID': 'global' } });
      setAgentLogs([]);
    } catch (e) {}
  };


  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('agent_debug_mode') === 'true');
  const [serverStartTime, setServerStartTime] = useState<number | null>(null);

  // Keep track of last sync time in local state
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(() => {
    const email = profile?.email?.toLowerCase().trim() || 'guest';
    return localStorage.getItem(`ghealth_${email}_last_sync`);
  });

  // Whenever syncState changes to 'synced', update last sync time to now
  useEffect(() => {
    if (syncState === 'synced') {
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const email = profile?.email?.toLowerCase().trim() || 'guest';
      localStorage.setItem(`ghealth_${email}_last_sync`, nowStr);
      setLastSyncTime(nowStr);
    }
  }, [syncState, profile?.email]);

  useEffect(() => {
    const email = profile?.email?.toLowerCase().trim() || 'guest';
    setLastSyncTime(localStorage.getItem(`ghealth_${email}_last_sync`));
  }, [profile?.email]);

  // Google Drive & Sheets Backup / Restore States
  const [googleAuthorized, setGoogleAuthorized] = useState(() => hasGoogleToken());
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);

  const [backupVersion, setBackupVersion] = useState('V1');
  const [backupPassword, setBackupPassword] = useState('');
  const [backupComment, setBackupComment] = useState('');
  const [backupStatus, setBackupStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [backupError, setBackupError] = useState('');
  const [backupResult, setBackupResult] = useState<any>(null);

  const [restoreFiles, setRestoreFiles] = useState<any[]>([]);
  const [selectedRestoreFile, setSelectedRestoreFile] = useState<any>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'listing' | 'downloading' | 'preview' | 'restoring' | 'success' | 'error'>('idle');
  const [restoreError, setRestoreError] = useState('');
  const [restorePreviewData, setRestorePreviewData] = useState<any[]>([]);
  const [restoreTargetAccount, setRestoreTargetAccount] = useState<string>('all'); // 'all' or specific account email
  const [restoreTargetFileBlob, setRestoreTargetFileBlob] = useState<Blob | null>(null);

  const handleOpenBackup = async () => {
    try {
      const token = await getGoogleAccessToken();
      setGoogleAuthorized(true);
      setBackupStatus('idle');
      setBackupError('');
      setBackupResult(null);
      setBackupPassword('');
      setBackupComment('');
      setShowBackupModal(true);
    } catch (err: any) {
      console.error("Google Auth failed:", err);
    }
  };

  const handleExecuteBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupPassword) {
      setBackupError("An encryption password is required to secure your backup ZIP file.");
      return;
    }
    setBackupStatus('processing');
    setBackupError('');
    try {
      const token = await getGoogleAccessToken();
      const result = await runBackupWorkflow(token, backupVersion, backupComment, backupPassword);
      setBackupResult(result);
      setBackupStatus('success');
    } catch (err: any) {
      console.error("Backup failed:", err);
      setBackupError(err.message || String(err));
      setBackupStatus('error');
    }
  };

  const handleOpenRestore = async () => {
    setRestoreStatus('listing');
    setRestoreError('');
    setRestoreFiles([]);
    setSelectedRestoreFile(null);
    setRestorePassword('');
    setRestorePreviewData([]);
    setRestoreTargetAccount('all');
    setRestoreTargetFileBlob(null);
    setShowRestoreModal(true);

    try {
      const token = await getGoogleAccessToken();
      setGoogleAuthorized(true);
      const files = await listBackupsFromDrive(token);
      setRestoreFiles(files);
      setRestoreStatus('idle');
    } catch (err: any) {
      console.error("Failed to list backups:", err);
      setRestoreError(err.message || "Failed to list backups from Google Drive.");
      setRestoreStatus('error');
    }
  };

  const handleSelectRestoreFile = (file: any) => {
    setSelectedRestoreFile(file);
    setRestorePassword('');
    setRestoreError('');
    setRestorePreviewData([]);
    setRestoreTargetFileBlob(null);
    setRestoreStatus('idle');
  };

  const handleLoadAndDecryptBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRestoreFile) return;
    setRestoreStatus('downloading');
    setRestoreError('');

    try {
      const token = await getGoogleAccessToken();
      const blob = await downloadFileFromDrive(token, selectedRestoreFile.id);
      setRestoreTargetFileBlob(blob);

      const preview = await previewBackupZip(blob, restorePassword);
      setRestorePreviewData(preview);
      setRestoreStatus('preview');
    } catch (err: any) {
      console.error("Unzip/Decrypt failed:", err);
      setRestoreError(err.message || "Decryption failed. Please verify your backup password.");
      setRestoreStatus('idle');
    }
  };

  const handleExecuteRestore = async () => {
    if (!restoreTargetFileBlob) return;
    if (!window.confirm("This will restore the selected records back to Firestore. Are you sure you want to proceed?")) {
      return;
    }

    setRestoreStatus('restoring');
    setRestoreError('');
    try {
      if (restoreTargetAccount === 'all') {
        for (const account of restorePreviewData) {
          if (account.jsonData) {
            await restoreAccountToFirestore(account.jsonData.uid, account.jsonData);
          }
        }
      } else {
        const account = restorePreviewData.find(acc => acc.email === restoreTargetAccount);
        if (account && account.jsonData) {
          await restoreAccountToFirestore(account.jsonData.uid, account.jsonData);
        } else {
          throw new Error("Selected account data not found in archive.");
        }
      }
      setRestoreStatus('success');
    } catch (err: any) {
      console.error("Restore failed:", err);
      setRestoreError(err.message || String(err));
      setRestoreStatus('error');
    }
  };

  const handleToggleDebugMode = (enabled: boolean) => {
    setDebugMode(enabled);
    localStorage.setItem('agent_debug_mode', enabled ? 'true' : 'false');
  };


  // Fetch real server start time
  useEffect(() => {
    fetch('/api/status')
      .then(r => {
        if (!r.ok) return null;
        return r.json().catch(() => null);
      })
      .then(d => {
        if (d && typeof d.startTime === 'number') {
          setServerStartTime(d.startTime);
        }
      })
      .catch(e => console.warn("Error fetching status:", e));
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
    setNickname(profile.nickname);
    setAge(profile.age);
    setEthnicity(profile.ethnicity);
    setWeight(profile.weight);
    setHeight(profile.height);
    setBloodType(profile.bloodType || '');
    setGender(profile.gender || 'Unknown');
    setUnitPreference(profile.unitPreference || 'SI');
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
      unitPreference: unitPreference as 'SI' | 'US',
      timezone
    };
    if (onSaveProfile) {
      onSaveProfile(finalProfile);
    } else {
      setProfile(finalProfile);
    }
    setIsEditing(false);
  };

  const isAdmin = profile?.userType === 'Admin' || profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com';

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
              <div className="flex items-center gap-1.5">
                <span
                  id="user-nickname-text"
                  className={`font-semibold text-theme-text truncate text-base leading-tight ${isAdmin ? 'cursor-pointer hover:text-rose-500' : ''}`}
                  title={isAdmin ? 'Admin: open bug snapshot capture' : undefined}
                  onClick={() => {
                    if (!isAdmin) return;
                    try {
                      document.getElementById('bug-snapshot-fab')?.click();
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {profile.nickname || 'Healthy User'}
                </span>
                {(() => {
                  const info = getAvailableCredits(profile);
                  return (
                    <span className="text-[9px] bg-indigo-50 dark:bg-indigo-950/45 text-indigo-600 dark:text-indigo-400 border border-indigo-100/30 dark:border-indigo-900/30 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-0.5" title={`${info.total} agent credits left`}>
                      <Coins className="w-2.5 h-2.5" />
                      {info.total}
                    </span>
                  );
                })()}
                {(() => {
                  const runningJobs = jobs.filter(j => j.status === 'running');
                  const queuedJobs = jobs.filter(j => j.status === 'queued');
                  const succeededUnsavedJobs = jobs.filter(j => j.status === 'succeeded' && !j.result?.savedToHistory && !j.viewed && !j.result?.viewed);
                  
                  const runningCount = runningJobs.length;
                  const queuedCount = queuedJobs.length;
                  const readyCount = succeededUnsavedJobs.length;

                  if (runningCount === 0 && queuedCount === 0 && readyCount === 0) return null;

                  const activeRunning = runningJobs[0];
                  const activeProgress = activeRunning?.progressPercent || 0;

                  const handleBadgeClick = () => {
                    const targetJob = succeededUnsavedJobs[0] || runningJobs[0] || queuedJobs[0];
                    if (!targetJob) return;
                    
                    const isMedical = targetJob.kind === 'medical';
                    const targetTab = isMedical ? 'medical' : 'food';

                    if (onNavigateTab) {
                      onNavigateTab(targetTab);
                    } else if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('navigate-tab', { detail: targetTab }));
                    }

                    // If this is a ready job, mark it as viewed to decrement count by 1
                    if (targetJob.status === 'succeeded') {
                      JobStore.updateJob(targetJob.id, {
                        viewed: true,
                        result: {
                          ...(targetJob.result || {}),
                          viewed: true
                        }
                      });
                    }

                    setTimeout(() => {
                      const jobEl = document.getElementById(`job-${targetJob.id}`) || document.getElementById(`task-card-${targetJob.id}`);
                      if (jobEl) {
                        jobEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      } else {
                        const fallbackEl = document.getElementById(isMedical ? 'active-medical-jobs' : 'food-history-tab');
                        if (fallbackEl) fallbackEl.scrollIntoView({ behavior: 'smooth' });
                      }
                    }, 150);
                  };

                  return (
                    <span 
                      onClick={handleBadgeClick}
                      className={`text-[9px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 border cursor-pointer hover:opacity-90 transition-all ${
                        runningCount > 0 
                          ? 'bg-indigo-600 border-indigo-500 text-white animate-pulse' 
                          : queuedCount > 0
                          ? 'bg-amber-500 border-amber-400 text-white'
                          : 'bg-emerald-600 border-emerald-500 text-white'
                      }`}
                      title={
                        runningCount > 0 
                          ? `${runningCount} job(s) running (${activeProgress}%)` 
                          : queuedCount > 0 
                          ? `${queuedCount} job(s) queued`
                          : `${readyCount} job result(s) ready`
                      }
                    >
                      {runningCount > 0 ? (
                        <>
                          <Loader className="w-2.5 h-2.5 animate-spin" />
                          <span>Active ({runningCount}){activeProgress > 0 ? ` • ${activeProgress}%` : ''}</span>
                        </>
                      ) : queuedCount > 0 ? (
                        <>
                          <span>Queued ({queuedCount})</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-2.5 h-2.5" />
                          <span>Ready ({readyCount})</span>
                        </>
                      )}
                    </span>
                  );
                })()}
              </div>
              <span className="text-[10px] text-slate-400 capitalize font-medium mt-0.5 block tracking-wide">
                {activeTab === 'home' ? 'Home' : activeTab === 'insights' ? 'Health insights' : activeTab === 'food' ? 'Food & Nutrition Logs' : activeTab === 'medical' ? 'Medical History' : activeTab === 'trends' ? 'Health Trends' : activeTab}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          <span
            onClick={() => {
              setDbOverlayViewMode('admin');
              setShowDbInteractionsOverlay(true);
            }}
            className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500 cursor-pointer hover:underline hover:text-indigo-600 transition-colors"
            title="Click to open Settings & Cloud Sync Control Panel"
          >
            Sync: {lastSyncTime || 'Ready'}
          </span>

          {isAdmin && (
            <button
              onClick={() => setIsTrackerOpen(true)}
              className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-650 dark:text-slate-300 rounded-2xl transition-all flex items-center justify-center cursor-pointer hover:scale-[1.03]"
              title="API Call Tracker"
            >
              <Activity className="w-5 h-5" />
            </button>
          )}

          {/* Sync Status Icon Indicator */}
          {(() => {
            const isAttentionNeeded = syncState === 'syncing' || dbInteractions.some(o => o.status === 'pending') || checkQuotaFlag();
            return (
              <button
                id="cloud-sync-btn"
                onClick={async () => {
                  if (onCloudSync) {
                    await onCloudSync();
                  }
                }}
                className={`flex items-center p-2 rounded-xl transition-colors cursor-pointer relative ${
                  isAttentionNeeded 
                    ? 'text-amber-500 hover:bg-amber-500/10' 
                    : 'text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Click to manually synchronize data with cloud database"
              >
                {syncState === 'syncing' && (
                  <RefreshCw className="w-5 h-5 text-amber-500 animate-spin" />
                )}
                {syncState === 'synced' && (
                  <CloudCheck className="w-5.5 h-5.5 text-slate-400 dark:text-slate-500" />
                )}
                {syncState === 'local' && (
                  checkQuotaFlag() ? (
                    <span title="Firestore Quota Exceeded - Offline Mode Only">
                      <CloudLightning className="w-5 h-5 text-amber-500 animate-pulse" />
                    </span>
                  ) : (
                    <CloudLightning className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                  )
                )}
                {dbInteractions.some(o => o.status === 'pending') && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                )}
              </button>
            );
          })()}
        </div>
      </div>
    
      <React.Suspense fallback={null}>
      {/* AI Agent Full Screen Logs */}
      <FullScreenLogViewer
        isOpen={showAgentLogs}
        onClose={() => setShowAgentLogs(false)}
        title="AI Agent Diagnostic Log History"
        logsText={agentLogs.map(l => `[${l.timestamp}] ${l.message}`).join('\n')}
        logsArray={agentLogs.map(l => `[${l.timestamp}]\n${l.message}`)}
        onClearLogs={handleClearAgentLogs}
        eventsCount={agentLogs.length}
      />
      <NutritionDataBrowserModal
        isOpen={showNutritionDataBrowser}
        onClose={() => setShowNutritionDataBrowser(false)}
      />
      <BugTrackerModal
        isOpen={showBugTracker}
        onClose={() => setShowBugTracker(false)}
        onViewJob={onViewJob}
      />
      <SyncDiagnosticsModal
        isOpen={showSyncDiagnostics}
        onClose={() => setShowSyncDiagnostics(false)}
      />
      <DedupeBiomarkerLogsModal
        isOpen={showDedupeBiomarkerLogs}
        onClose={() => setShowDedupeBiomarkerLogs(false)}
      />
      </React.Suspense>
      {isAdmin && (
        <BugSnapshotFab
          isAdmin={isAdmin}
          firebaseUid={auth.currentUser?.uid || null}
          activeTab={activeTab}
          viewingJobId={viewingJobId}
          biomarkerHistory={biomarkerHistory}
          biomarkers={biomarkers}
          profile={profile}
          getModalContext={() => {
            try {
              const jobs = JobStore.getAllJobs?.() || [];
              const fromModal = viewingJobId ? jobs.find((j) => j.id === viewingJobId) : null;
              const tab = String(activeTab || '').toLowerCase();
              const bioTab = ['home', 'health', 'medical', 'insights', 'trends', 'dictionary'].includes(tab);
              const foodTab = tab === 'food';
              const candidates = [...jobs]
                .filter((j) =>
                  j.kind !== 'bug_triage' &&
                  !String(j.id).startsWith('triage_') &&
                  !String(j.id).startsWith('bug_triage_')
                )
                .filter((j) => {
                  const k = String(j.kind || '').toLowerCase();
                  const isFood = k === 'food' || k.startsWith('food_');
                  const isMed = k.includes('medical') || k.includes('biomarker');
                  if (bioTab && !foodTab) return isMed;
                  if (foodTab) return isFood;
                  return true;
                })
                .sort((a, b) => String(b.id).localeCompare(String(a.id)));
              const active =
                fromModal ||
                candidates.find((j) => j.status === 'running' || j.status === 'awaiting_user') ||
                candidates.find((j) => j.status === 'succeeded' || j.status === 'failed') ||
                candidates[0];
              if (!active) {
                return {
                  activeTab,
                  jobsCount: jobs.length,
                  biomarkers,
                  biomarkerHistoryCount: Array.isArray(biomarkerHistory) ? biomarkerHistory.length : 0,
                  deletedBiomarkerLogIds: profile?.deletedBiomarkerLogIds || {},
                  deletedCustomBiomarkerKeys: profile?.deletedCustomBiomarkerKeys || {},
                  deletedNotUsedBiomarkerKeys: profile?.deletedNotUsedBiomarkerKeys || {},
                };
              }
              return {
                activeTab,
                jobId: active.id,
                kind: active.kind,
                mode: (active as any).mode || (active as any).inputSnapshot?.mode,
                status: active.status,
                progressPercent: active.progressPercent,
                result: active.result,
                pendingFoodLog: active.result?.pendingFoodLog || active.result?.data?.pendingFoodLog,
                backendLogs:
                  active.result?.backendLogs ||
                  active.liveThoughts?.backendLogs ||
                  undefined,
                pipelineErrors: active.result?.pipelineErrors,
                scoutItems: active.result?.scoutItems,
                photoUrl: active.photoUrl || active.result?.photoUrl,
                debugUrl: active.result?.debugUrl || active.debugUrl,
              };
            } catch {
              return { activeTab };
            }
          }}
        />
      )}
    </header>


      {/* Editing Dialog Slide-down for Profile Parameters */}
      {isEditing && createPortal((
        <div id="profile-edit-modal" className="fixed inset-0 z-[100] bg-white dark:bg-slate-900 sm:bg-slate-900/60 sm:backdrop-blur-sm flex items-center justify-center sm:p-4 overflow-hidden">
          <div className="w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 sm:border border-slate-200 dark:border-slate-800 sm:rounded-3xl sm:shadow-xl max-w-lg animation-fade-in text-slate-800 dark:text-slate-100 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-theme-text">Edit Profile</h2>
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
                    compressImage(file, 200, 200, 0.5)
                      .then((compressedBase64) => {
                        const updated = { ...profile, photoUrl: compressedBase64 };
                        if (onSaveProfile) {
                          onSaveProfile(updated);
                        } else {
                          setProfile(updated);
                        }
                      })
                      .catch((err) => {
                        console.error("Failed to compress profile photo, falling back to raw reader:", err);
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
                      });
                  }
                }}
                className="text-xs text-slate-500 dark:text-slate-400 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-indigo-50 file:text-indigo-600 dark:file:bg-indigo-950/40 dark:file:text-indigo-400 hover:file:bg-indigo-100/50 cursor-pointer w-full"
              />
            </div>
          </div>

          {/* Agent Credit Status Panel */}
          {(() => {
            const creditInfo = getAvailableCredits(profile);
            return (
              <div className="bg-gradient-to-br from-indigo-50/60 to-purple-50/60 dark:from-indigo-950/20 dark:to-purple-950/20 border border-indigo-100/60 dark:border-indigo-900/40 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">AI Agent Credits</span>
                  </div>
                  <span className="text-[10px] bg-indigo-100/80 dark:bg-indigo-950/65 text-indigo-700 dark:text-indigo-450 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    {creditInfo.userType} Account
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/85 rounded-xl p-2">
                    <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Available</span>
                    <span className="text-lg font-black text-slate-800 dark:text-slate-100">{creditInfo.total}</span>
                    <span className="block text-[8px] text-slate-500">Credits left</span>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/85 rounded-xl p-2">
                    <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Daily Quota</span>
                    <span className="text-lg font-black text-slate-800 dark:text-slate-100">{creditInfo.daily}</span>
                    <span className="block text-[8px] text-slate-500">resets in {creditInfo.nextResetStr}</span>
                  </div>
                </div>

                {/* Granted Credits / Duration info */}
                {creditInfo.grantedDetails.length > 0 && (
                  <div className="bg-white/80 dark:bg-slate-900/60 border border-slate-100/50 dark:border-slate-800/45 rounded-xl p-2.5 space-y-1.5 text-left">
                    <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Granted Credits (active)</span>
                    {creditInfo.grantedDetails.map((gc, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[10px] text-slate-650 dark:text-slate-350">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">+{gc.amount} credits</span>
                        <span className="text-[9px] font-mono text-slate-400">Expires: {new Date(gc.expiresAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

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
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Unit Preference</label>
              <select
                value={unitPreference}
                onChange={(e) => setUnitPreference(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="SI">SI Units (International)</option>
                <option value="US">US Units</option>
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

            {/* Admin View & Sync Control Center Link */}
            {isAdmin && (
              <div className="col-span-2 bg-gradient-to-r from-indigo-50/90 to-purple-50/90 dark:from-indigo-950/40 dark:to-purple-950/40 border border-indigo-200/70 dark:border-indigo-800/60 rounded-2xl p-3.5 mt-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Admin Control & Sync Nav</span>
                  </div>
                  <span className="text-[9px] bg-indigo-600 text-white font-bold px-2 py-0.5 rounded-full uppercase">
                    Admin Mode
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mb-2.5">
                  Access live telemetry, manage database syncs, configure backups, and view user records.
                </p>
                <button
                  type="button"
                  id="open-admin-nav-link"
                  onClick={() => {
                    setIsEditing(false);
                    setDbOverlayViewMode('admin');
                    setShowDbInteractionsOverlay(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-3 rounded-xl shadow-sm transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Open Admin Control & Sync Settings</span>
                </button>
              </div>
            )}

            {/* Preferences & Session */}
            <div className="col-span-2 border-t border-slate-100 dark:border-slate-800/85 mt-2 pt-3 text-left">
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
                  onClick={() => {
                    clearGoogleToken();
                    onSignOut();
                  }}
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
      
      {/* Inspector Popup */}
      {themePreviewMode && inspectedElement && createPortal((
        <div id="inspector-popup" className="fixed z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-4 flex flex-col gap-3 w-64" style={{ top: Math.min(window.innerHeight - 250, inspectedElement.rect.bottom + 10), left: Math.min(window.innerWidth - 270, Math.max(10, inspectedElement.rect.left)) }}>
          <div className="flex justify-between items-center">
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate flex-1">{inspectedElement.selector}</h4>
            <button onClick={() => { revertPreview(); setInspectedElement(null); }} className="text-slate-400 hover:text-slate-600 ml-2">✕</button>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Property</label>
            <select value={inspectorProperty} onChange={e => {
              revertPreview();
              setInspectorProperty(e.target.value);
            }} className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-slate-900 dark:text-slate-100">
              <option value="color">Text Color (color)</option>
              <option value="background-color">Background Color</option>
              <option value="border-color">Border Color</option>
              <option value="font-family">Font Family</option>
              <option value="font-size">Font Size</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Variable</label>
            <select value={inspectorVariable} onChange={e => {
              const val = e.target.value;
              setInspectorVariable(val);
              if (inspectedElement?.el) applyPreview(val, inspectorProperty, inspectedElement.el);
            }} className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-slate-900 dark:text-slate-100">
              <option value="">Select variable...</option>
              {inspectorProperty.includes('color') ? (
                <>
                  {colorsList.map((color: any) => (
                    <option key={color.key} value={`var(${getColorVariable(color.key)})`}>
                      {color.label}
                    </option>
                  ))}
                </>
              ) : inspectorProperty === 'font-size' ? (
                <>
                  {fontsList.map((font: any) => (
                    <option key={font.key} value={`var(${getFontVariable(font.key)})`}>
                      {font.label}
                    </option>
                  ))}
                </>
              ) : (
                <>
                  <option value="var(--font-sans)">Sans Font</option>
                  <option value="var(--font-mono)">Mono Font</option>
                  <option value="var(--font-display)">Display Font</option>
                </>
              )}
            </select>
          </div>
          <button onClick={saveOverride} className="w-full py-1.5 mt-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold">Assign Variable</button>
        </div>
      ), document.body)}

      {/* Inspector Highlight Box */}
      {themePreviewMode && inspectedElement && createPortal((
        <div
          id="inspector-highlight"
          className="fixed pointer-events-none z-[99] border-2 border-indigo-500 bg-indigo-500/10 rounded transition-all duration-150"
          style={{
            top: inspectedElement.rect.top,
            left: inspectedElement.rect.left,
            width: inspectedElement.rect.width,
            height: inspectedElement.rect.height,
          }}
        />
      ), document.body)}

{showThemeScreen && createPortal((
        <>
          <style>{`
            #root {
              transform: translateX(0) !important; /* containing block for fixed children */
              transition: all 0.3s ease;
            }
            @media (min-width: 800px) {
              #root {
                width: 50vw !important;
                margin-left: 50vw !important;
              }
            }
            @media (max-width: 799px) {
              #root {
                margin-top: ${themeCompactMode ? '200px' : '50vh'} !important;
              }
            }
          `}</style>
        <div id="theme-customizer-screen" className="fixed inset-0 z-[60] pointer-events-none">
          <div className={`bg-white dark:bg-slate-900 shadow-2xl flex flex-col animation-fade-in text-slate-800 dark:text-slate-100 pointer-events-auto transition-all duration-300 border-r border-slate-200 dark:border-slate-800
            ${themeCompactMode 
               ? 'fixed top-0 left-0 w-full h-[200px] rounded-b-2xl shadow-xl z-[70] overflow-hidden' 
               : 'fixed top-0 left-0 w-full min-[800px]:w-1/2 h-[50vh] min-[800px]:h-[100vh] rounded-b-3xl min-[800px]:rounded-none shadow-2xl z-[70] overflow-hidden'}
          `}>
            {themeCompactMode && (
              <button
                onClick={() => setThemeCompactMode(false)}
                className="absolute top-4 right-4 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full shadow-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 z-[80]"
                title="Expand"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
              </button>
            )}
            
            {/* Header */}
            {!themeCompactMode && (
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <h2 className="text-base font-bold whitespace-nowrap" style={{ color: profile.themePalette?.textDarkPrimary || 'var(--theme-text-dark-primary, rgba(255, 255, 255, 0.9))' }}>Theme</h2>
                <select
                  value={themeActiveSection}
                  onChange={(e) => setThemeActiveSection(e.target.value as any)}
                  className="text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-250 dark:border-slate-700 rounded-full pl-3.5 pr-8 py-1.5 text-slate-900 dark:text-slate-100 focus:outline-none cursor-pointer shadow-sm w-full sm:w-auto"
                >
                  <option value="colors">🎨 Colours</option>
                  <option value="fonts">🔤 Font</option>
                  <option value="tokens">📐 Token</option>
                  <option value="components">📦 Components</option>
                  <option value="elements">🔗 Elements</option>
                  <option value="presets">🔖 Presets</option>
                </select>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  onClick={() => setThemeCompactMode(!themeCompactMode)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer mr-1"
                  title={themeCompactMode ? "Expand" : "Compact Mode"}
                >
                  {themeCompactMode ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                  )}
                </button>
                <button
                  onClick={() => {
                    setInspectorPaused(!inspectorPaused);
                    if (!inspectorPaused) {
                      revertPreview();
                      setInspectedElement(null);
                    }
                  }}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer mr-1 ${
                    inspectorPaused
                      ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
                      : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title={inspectorPaused ? 'Resume click-to-assign' : 'Pause click-to-assign (interact with the page)'}
                >
                  {inspectorPaused ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  )}
                </button>
                <button
                  onClick={() => {
                    if (onSaveProfile) {
                      onSaveProfile(profile);
                    }
                    initialThemeSnapshot.current = null;
                    setThemePreviewMode(false);
                    revertPreview();
                    setInspectedElement(null);
                    setShowThemeScreen(false);
                  }}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
                >
                  {t.save}
                </button>
                <button
                  onClick={() => {
                    setThemePreviewMode(false);
                    revertPreview();
                    setInspectedElement(null);
                    setShowThemeScreen(false);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Close theme editor"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            )}

            {/* Content scroll area */}
            <div className={`p-6 overflow-y-auto space-y-6 text-left flex-1 ${themeCompactMode ? 'pt-14' : ''}`}>
              
              {/* COLORS SECTION */}
              {themeActiveSection === 'colors' && (
                <div className="space-y-4">
                  {(() => {
                    const getEffectiveGroup = (color: any) => {
                      if (textPreviewOverride[color.key]) return textPreviewOverride[color.key];
                      if (color.key === 'textDarkPrimary' || color.key === 'textDarkSecondary') return 'dark';
                      if (color.key === 'text' || color.key === 'textSecondary' || color.key === 'textAccent' || color.key === 'textMuted' || color.key === 'textSuccess' || color.key === 'textError') return 'light';
                      return color.darkGroup || 'light';
                    };

                    const generalColors = colorsList.filter((c: any) => c.category === 'general' || ['button', 'background', 'bgCard', 'border', 'neutralSetting'].includes(c.key));
                    const textColors = colorsList.filter((c: any) => c.category === 'text' || ['text', 'textSecondary', 'textDarkPrimary', 'textDarkSecondary', 'textAccent', 'textMuted', 'textSuccess', 'textError'].includes(c.key));
                    const statusColors = colorsList.filter((c: any) => c.category === 'status' || ['warning', 'caution', 'success', 'info'].includes(c.key));
                    const nutrientColors = colorsList.filter((c: any) => c.category === 'nutrients' || ['nutrientCalories', 'nutrientProtein', 'nutrientCarbs', 'nutrientFat', 'nutrientSatFat', 'nutrientSodium'].includes(c.key));

                    const renderColorItem = (color: any) => {
                      const activeVal = (profile.themePalette as any)?.[color.key] || color.defaultHex;
                      const isExpanded = expandedColorKey === color.key;
                      const draftLabel = colorDraft && colorDraft.key === color.key ? colorDraft.label : color.label;
                      const draftVal = colorDraft && colorDraft.key === color.key ? colorDraft.value : activeVal;

                      return (
                        <div key={color.key} className="transition-all duration-200">
                          {/* Main Row */}
                          <div 
                            className="flex items-center justify-between py-2 px-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 rounded-xl transition-all group"
                          >
                            <div className="flex items-center min-w-0 flex-1">
                              {/* Swatch */}
                              <div 
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedColorKey(null);
                                    setColorDraft(null);
                                  } else {
                                    colorOriginalVal.current[color.key] = activeVal;
                                    setExpandedColorKey(color.key);
                                    setColorDraft({ key: color.key, label: color.label, value: activeVal });
                                  }
                                }}
                                className="w-5 h-5 rounded-full shadow-inner shrink-0 cursor-pointer hover:opacity-80 transition-opacity border border-black/10 dark:border-white/10" 
                                style={{ backgroundColor: activeVal }}
                                title={isExpanded ? 'Close editor' : 'Click to edit'}
                              />
                              <div 
                                className="ml-3 min-w-0 flex-1 cursor-pointer"
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedColorKey(null);
                                    setColorDraft(null);
                                  } else {
                                    colorOriginalVal.current[color.key] = activeVal;
                                    setExpandedColorKey(color.key);
                                    setColorDraft({ key: color.key, label: color.label, value: activeVal });
                                  }
                                }}
                              >
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 block truncate">
                                  {color.label}
                                </span>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 block truncate">
                                  {color.description || 'Color variable'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Expanded Editor State */}
                          {isExpanded && (() => {
                            const { hex6, opacity } = parseColorAndOpacity(draftVal);
                            return (
                              <div className="mt-1 ml-8 p-3 bg-slate-50 dark:bg-slate-900 rounded-xl space-y-3 shadow-inner text-left">
                                <div className="flex flex-col gap-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Variable Name</label>
                                  <input
                                    type="text"
                                    value={draftLabel}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setColorDraft(d => d && d.key === color.key ? { ...d, label: e.target.value } : d)}
                                    className="text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg px-2.5 py-1.5 focus:border-indigo-500 focus:outline-none transition-all w-full"
                                    placeholder="E.g. Primary Accent"
                                  />
                                </div>

                                <div className="flex flex-col gap-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Colour & Hex</label>
                                  <div className="flex items-center gap-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg p-1.5 shadow-sm">
                                    <input
                                      type="color"
                                      value={hex6}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const newVal = formatColorWithOpacity(e.target.value, opacity);
                                        setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                        }));
                                      }}
                                      className="w-6 h-6 rounded cursor-pointer overflow-hidden border border-slate-200 dark:border-slate-850 shrink-0 bg-transparent"
                                      style={{ padding: 0, border: 'none' }}
                                    />
                                    <input
                                      type="text"
                                      value={draftVal}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const newVal = e.target.value;
                                        setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                        }));
                                      }}
                                      className="w-full text-xs font-mono bg-transparent text-slate-800 dark:text-slate-100 focus:outline-none px-1"
                                      placeholder="#FFFFFF"
                                    />
                                  </div>
                                </div>

                                {/* Opacity Control */}
                                <div className="flex flex-col gap-1">
                                  <div className="flex justify-between items-center text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                    <span>Opacity</span>
                                    <span className="text-slate-600 dark:text-slate-300 font-mono text-[10px]">{opacity}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={opacity}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      const newOpacity = parseInt(e.target.value, 10);
                                      const newVal = formatColorWithOpacity(hex6, newOpacity);
                                      setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                      setProfile(p => ({
                                        ...p,
                                        themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                      }));
                                    }}
                                    className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                                  />
                                </div>

                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!colorDraft) return;
                                      const currentList = [...(profile.customColors || auditColors)];
                                      const updatedList = currentList.map((c: any) => c.key === color.key ? { ...c, label: colorDraft.label } : c);
                                      const nextPalette = { ...(profile.themePalette || {}) };
                                      (nextPalette as any)[color.key] = colorDraft.value;
                                      if (color.key === 'background') {
                                        nextPalette.bgApp = colorDraft.value;
                                      }
                                      setProfile({ ...profile, customColors: updatedList, themePalette: nextPalette });
                                      setExpandedColorKey(null);
                                      setColorDraft(null);
                                    }}
                                    className="flex-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (colorOriginalVal.current[color.key] !== undefined) {
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: colorOriginalVal.current[color.key] }
                                        }));
                                      }
                                      setExpandedColorKey(null);
                                      setColorDraft(null);
                                    }}
                                    className="flex-1 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  {color.key?.startsWith('custom_') && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteColor(color.key);
                                        setExpandedColorKey(null);
                                        setColorDraft(null);
                                      }}
                                      className="flex-1 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-bold border border-rose-200 dark:border-rose-800 transition-all cursor-pointer"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    };

                    const renderTextColorItem = (color: any, sectionMode: 'dark' | 'light') => {
                      const activeVal = (profile.themePalette as any)?.[color.key] || color.defaultHex;
                      const isExpanded = expandedColorKey === color.key;
                      const draftLabel = colorDraft && colorDraft.key === color.key ? colorDraft.label : color.label;
                      const draftVal = colorDraft && colorDraft.key === color.key ? colorDraft.value : activeVal;

                      return (
                        <div key={color.key} className="transition-all duration-200">
                          {/* Main Row */}
                          <div 
                            className={sectionMode === 'dark'
                              ? "flex items-center justify-between py-2 px-3 hover:bg-slate-800/60 rounded-xl transition-all group gap-2"
                              : "flex items-center justify-between py-2 px-3 hover:bg-slate-150/80 rounded-xl transition-all group gap-2"}
                          >
                            <div className="flex items-center min-w-0 flex-1">
                              {/* Swatch */}
                              <div 
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedColorKey(null);
                                    setColorDraft(null);
                                  } else {
                                    colorOriginalVal.current[color.key] = activeVal;
                                    setExpandedColorKey(color.key);
                                    setColorDraft({ key: color.key, label: color.label, value: activeVal });
                                  }
                                }}
                                className="w-5 h-5 rounded-full shadow-inner shrink-0 cursor-pointer hover:opacity-80 transition-opacity border border-black/10 dark:border-white/10" 
                                style={{ backgroundColor: activeVal }}
                                title={isExpanded ? 'Close editor' : 'Click to edit'}
                              />
                              <div 
                                className="ml-3 min-w-0 flex-1 cursor-pointer"
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedColorKey(null);
                                    setColorDraft(null);
                                  } else {
                                    colorOriginalVal.current[color.key] = activeVal;
                                    setExpandedColorKey(color.key);
                                    setColorDraft({ key: color.key, label: color.label, value: activeVal });
                                  }
                                }}
                              >
                                <span 
                                  className="text-xs font-bold block truncate transition-colors"
                                  style={{ color: activeVal }}
                                >
                                  {color.label}
                                </span>
                                <span className={sectionMode === 'dark' ? "text-[10px] text-slate-400 block truncate" : "text-[10px] text-slate-500 block truncate"}>
                                  {color.description || 'Text color variable'}
                                </span>
                              </div>
                            </div>

                            {/* Light / Dark Toggle button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const currentMode = getEffectiveGroup(color);
                                const newMode = currentMode === 'dark' ? 'light' : 'dark';
                                setTextPreviewOverride(prev => ({ ...prev, [color.key]: newMode }));
                                const currentList = [...(profile.customColors || auditColors)];
                                const updatedList = currentList.map((c: any) => c.key === color.key ? { ...c, darkGroup: newMode } : c);
                                setProfile({ ...profile, customColors: updatedList });
                              }}
                              className={sectionMode === 'dark' 
                                ? "text-slate-400 hover:text-amber-300 hover:bg-slate-800 p-1.5 rounded-lg transition-all cursor-pointer shrink-0 ml-2" 
                                : "text-slate-400 hover:text-indigo-600 hover:bg-slate-200 p-1.5 rounded-lg transition-all cursor-pointer shrink-0 ml-2"}
                              title={sectionMode === 'dark' ? 'Move to Text over light' : 'Move to Text over dark'}
                            >
                              {sectionMode === 'dark' ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
                              )}
                            </button>
                          </div>

                          {/* Expanded Editor State */}
                          {isExpanded && (() => {
                            const { hex6, opacity } = parseColorAndOpacity(draftVal);
                            return (
                              <div className="mt-1 ml-8 p-3 bg-slate-50 dark:bg-slate-900 rounded-xl space-y-3 shadow-inner text-left">
                                <div className="flex flex-col gap-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Variable Name</label>
                                  <input
                                    type="text"
                                    value={draftLabel}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setColorDraft(d => d && d.key === color.key ? { ...d, label: e.target.value } : d)}
                                    className="text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg px-2.5 py-1.5 focus:border-indigo-500 focus:outline-none transition-all w-full"
                                    placeholder="E.g. Brand Heading"
                                  />
                                </div>

                                <div className="flex flex-col gap-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Colour & Hex</label>
                                  <div className="flex items-center gap-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg p-1.5 shadow-sm">
                                    <input
                                      type="color"
                                      value={hex6}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const newVal = formatColorWithOpacity(e.target.value, opacity);
                                        setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                        }));
                                      }}
                                      className="w-6 h-6 rounded cursor-pointer overflow-hidden border border-slate-200 dark:border-slate-850 shrink-0 bg-transparent"
                                      style={{ padding: 0, border: 'none' }}
                                    />
                                    <input
                                      type="text"
                                      value={draftVal}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const newVal = e.target.value;
                                        setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                        }));
                                      }}
                                      className="w-full text-xs font-mono bg-transparent text-slate-800 dark:text-slate-100 focus:outline-none px-1"
                                      placeholder="#FFFFFF or rgba(255,255,255,0.9)"
                                    />
                                  </div>
                                </div>

                                {/* Opacity Control */}
                                <div className="flex flex-col gap-1">
                                  <div className="flex justify-between items-center text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                    <span>Opacity</span>
                                    <span className="text-slate-600 dark:text-slate-300 font-mono text-[10px]">{opacity}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={opacity}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      const newOpacity = parseInt(e.target.value, 10);
                                      const newVal = formatColorWithOpacity(hex6, newOpacity);
                                      setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                      setProfile(p => ({
                                        ...p,
                                        themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                      }));
                                    }}
                                    className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                                  />
                                </div>

                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!colorDraft) return;
                                      const currentList = [...(profile.customColors || auditColors)];
                                      const updatedList = currentList.map((c: any) => c.key === color.key ? { ...c, label: colorDraft.label } : c);
                                      const nextPalette = { ...(profile.themePalette || {}) };
                                      (nextPalette as any)[color.key] = colorDraft.value;
                                      setProfile({ ...profile, customColors: updatedList, themePalette: nextPalette });
                                      setExpandedColorKey(null);
                                      setColorDraft(null);
                                    }}
                                    className="flex-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (colorOriginalVal.current[color.key] !== undefined) {
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: colorOriginalVal.current[color.key] }
                                        }));
                                      }
                                      setExpandedColorKey(null);
                                      setColorDraft(null);
                                    }}
                                    className="flex-1 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  {color.key?.startsWith('custom_') && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteColor(color.key);
                                        setExpandedColorKey(null);
                                        setColorDraft(null);
                                      }}
                                      className="flex-1 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-bold border border-rose-200 dark:border-rose-800 transition-all cursor-pointer"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    };

                    return (
                      <div className="space-y-6">
                        {/* 1. General Colours */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">General colours</span>
                            <button
                              type="button"
                              onClick={() => handleAddColor('general')}
                              className="px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1"
                            >
                              <span>➕ Add Color</span>
                            </button>
                          </div>
                          <div className="space-y-1">
                            {generalColors.map(color => renderColorItem(color))}
                          </div>
                        </div>

                        {/* 2. Text Colours */}
                        <div className="space-y-3">
                          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Text colour</span>
                            <button
                              type="button"
                              onClick={() => handleAddColor('text')}
                              className="px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1"
                            >
                              <span>➕ Add Color</span>
                            </button>
                          </div>

                          {/* SUBSECTION 1: TEXT OVER DARK */}
                          <div className="space-y-2 bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-inner">
                            <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                <span>🌙</span> Text over dark
                              </span>
                              <span className="text-[9px] text-slate-500 font-medium">Dark background</span>
                            </div>
                            <div className="space-y-1 pt-1">
                              {textColors.filter((color: any) => getEffectiveGroup(color) === 'dark').map(color => renderTextColorItem(color, 'dark'))}
                            </div>
                          </div>

                          {/* SUBSECTION 2: TEXT OVER LIGHT */}
                          <div className="space-y-2 bg-slate-50 border border-slate-200 rounded-2xl p-3.5 shadow-sm">
                            <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                                <span>☀️</span> Text over light
                              </span>
                              <span className="text-[9px] text-slate-400 font-medium">Light background</span>
                            </div>
                            <div className="space-y-1 pt-1">
                              {textColors.filter((color: any) => getEffectiveGroup(color) === 'light').map(color => renderTextColorItem(color, 'light'))}
                            </div>
                          </div>
                        </div>

                        {/* 3. Status */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Status</span>
                            <button
                              type="button"
                              onClick={() => handleAddColor('status')}
                              className="px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1"
                            >
                              <span>➕ Add Color</span>
                            </button>
                          </div>
                          <div className="space-y-1">
                            {statusColors.map(color => renderColorItem(color))}
                          </div>
                        </div>

                        {/* 4. Nutrients & Targets */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Nutrients & Targets</span>
                            <button
                              type="button"
                              onClick={() => handleAddColor('nutrients')}
                              className="px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1"
                            >
                              <span>➕ Add Color</span>
                            </button>
                          </div>
                          <div className="space-y-1">
                            {nutrientColors.map(color => renderColorItem(color))}
                          </div>
                        </div>

                        {/* Theme Action Buttons */}
                        <div className="flex justify-end items-center px-4 py-2 mt-4 gap-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                          <button
                            type="button"
                            onClick={() => setProfile({
                              ...profile,
                              marginScale: undefined,
                              paddingScale: undefined,
                              cornerRadius: undefined,
                              shadowScale: undefined,
                              themePalette: undefined,
                              customColors: undefined,
                              customFonts: undefined,
                              fontSize: undefined,
                              fontFamily: undefined,
                              fontMono: undefined,
                              fontSizeTitle: undefined,
                              fontSizeSubtitle: undefined,
                              fontSizeDescription: undefined,
                              fontSizeBodySmall: undefined,
                              fontSizeSubtitleSmall: undefined,
                              fontSizeKeyMetric: undefined,
                              fontSizeXS: undefined,
                              fontSizeBody: undefined
                            })}
                            className="px-4 py-2 bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm"
                          >
                            Reset Theme
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* FONTS SECTION */}
              {themeActiveSection === 'fonts' && (
                <div className="grid grid-cols-2 gap-3">
                  {fontsList.map((font: any) => {
                    const activeVal = (profile as any)[font.fontSizeKey] || 'normal';
                    return (
                      <div key={font.key} className="relative group p-3 rounded-2xl flex flex-col items-center justify-center bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 shadow-sm gap-2 text-center">
                        {/* Inline editable label */}
                        <input
                          type="text"
                          value={font.label}
                          onChange={(e) => handleRenameFont(font.key, e.target.value)}
                          className="text-[11px] font-bold text-slate-800 dark:text-slate-100 w-full text-center bg-transparent border-b border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:border-indigo-500 focus:outline-none transition-all cursor-pointer truncate mb-1"
                          title="Click to rename"
                        />
                        <CustomFontSelect value={activeVal} options={font.options} onChange={(val) => setProfile({ ...profile, [font.fontSizeKey]: val })} />
                      </div>
                    );
                  })}

                  <div className="p-3 rounded-2xl space-y-2 flex flex-col items-center justify-center bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 shadow-sm">
                    <span className="block text-[11px] font-bold text-slate-800 dark:text-slate-100 text-center">Sans Font</span>
                    <CustomFontSelect isFamily value={profile.fontFamily || 'Inter'} options={[
                      {value: 'Inter', label: 'Inter'},
                      {value: 'Space Grotesk', label: 'Space Grotesk'},
                      {value: 'Outfit', label: 'Outfit'},
                      {value: 'Playfair Display', label: 'Playfair Display'},
                      {value: 'Merriweather', label: 'Merriweather'},
                      {value: 'system-ui', label: 'System UI'},
                      {value: 'Roboto', label: 'Roboto'},
                      {value: 'Open Sans', label: 'Open Sans'},
                      {value: 'Lato', label: 'Lato'},
                      {value: 'Montserrat', label: 'Montserrat'},
                      {value: 'Poppins', label: 'Poppins'}
                    ]} onChange={(val) => setProfile({ ...profile, fontFamily: val })} />
                  </div>

                  <div className="p-3 rounded-2xl space-y-2 flex flex-col items-center justify-center bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 shadow-sm">
                    <span className="block text-[11px] font-bold text-slate-800 dark:text-slate-100 text-center">Mono Font</span>
                    <CustomFontSelect isFamily value={profile.fontMono || 'JetBrains Mono'} options={[
                      {value: 'JetBrains Mono', label: 'JetBrains Mono'},
                      {value: 'Courier New', label: 'Courier New'}
                    ]} onChange={(val) => setProfile({ ...profile, fontMono: val })} />
                  </div>
                </div>
              )}

              {/* DESIGN TOKENS SECTION */}
              {themeActiveSection === 'tokens' && (
                <div className="grid grid-cols-2 gap-3">
                  {auditDesignTokens.map((token) => {
                    const activeVal = (profile as any)[token.tokenKey] || token.defaultValue;
                    return (
                      <div key={token.key} className="p-3 rounded-2xl space-y-2 flex flex-col items-center justify-center">
                        <span className="block text-[11px] font-bold text-slate-800 dark:text-slate-100 text-center">{token.label}</span>
                        <select
                          value={activeVal}
                          onChange={(e) => setProfile({ ...profile, [token.tokenKey]: e.target.value })}
                          className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-250 dark:border-slate-700 rounded-xl px-2 py-1.5 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer text-center"
                        >
                          {token.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label.split(' ')[0]}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* COMPONENTS SECTION */}
              {themeActiveSection === 'components' && (
                <div className="grid grid-cols-1 gap-4">
                  <div className="p-4 rounded-3xl flex flex-col gap-4">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Top Targets Progress Bar</span>
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Calories</span>
                          <span className="text-slate-500 font-mono">1500kcal / 2000kcal</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2">
                          <div className="bg-indigo-500 h-2 rounded-full" style={{ width: '75%' }}></div>
                        </div>
                      </div>
                      
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Protein</span>
                          <span className="text-slate-500 font-mono">60g / 73g</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2">
                          <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '82%' }}></div>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Saturated Fat</span>
                          <span className="text-slate-500 font-mono">18g / 15g</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2">
                          <div className="bg-rose-500 h-2 rounded-full" style={{ width: '100%' }}></div>
                        </div>
                      </div>
                      
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Sodium</span>
                          <span className="text-slate-500 font-mono">1200mg / 2000mg</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2">
                          <div className="bg-amber-500 h-2 rounded-full" style={{ width: '60%' }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 rounded-3xl flex flex-col items-center justify-center gap-4">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider self-start">Nutrients Pie Chart</span>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 w-full">
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={2000} alreadyConsumed={500} mealValue={400} nutrientKey="calories" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Calories</span>
                       </div>
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={60} alreadyConsumed={20} mealValue={15} nutrientKey="protein" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Protein</span>
                       </div>
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={300} alreadyConsumed={100} mealValue={80} nutrientKey="carbs" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Carbs</span>
                       </div>
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={65} alreadyConsumed={20} mealValue={15} nutrientKey="fat" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Fat</span>
                       </div>
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={20} alreadyConsumed={5} mealValue={2} nutrientKey="saturatedFat" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Sat Fat</span>
                       </div>
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={2300} alreadyConsumed={1000} mealValue={400} nutrientKey="sodium" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Sodium</span>
                       </div>
                    </div>
                  </div>

                  
                  <div className="flex flex-col gap-3 p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">LogChat Bubble</span>
                    <div className="self-end bg-indigo-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm shadow-sm max-w-[85%] font-medium">
                      I had a grilled chicken salad and a glass of milk.
                    </div>
                    <div className="self-start bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-700 px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm shadow-sm max-w-[85%] font-medium">
                      I've logged 1 chicken salad and 1 glass of milk. (450 kcal)
                    </div>
                  </div>

                  
                  <div className="p-4 rounded-3xl border border-slate-200 dark:border-slate-800 flex flex-col gap-3 w-full">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">FoodCard Capsule</span>
                    <div className="flex gap-3 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm items-center w-full">
                      <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center text-2xl shadow-inner shrink-0">
                        🥗
                      </div>
                      <div className="flex flex-col flex-1">
                        <span className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">Grilled Chicken Salad</span>
                        <span className="text-xs text-slate-500 font-medium mt-0.5">350 kcal • 40g Protein</span>
                      </div>
                      <button className="text-slate-400 hover:text-rose-500 p-2 shrink-0">✕</button>
                    </div>
                  </div>

                  
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/20 border border-slate-200 dark:border-slate-800 rounded-3xl flex flex-col gap-3 w-full">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Biomarker Expanded Section</span>
                    <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-xl w-full">
                      <div className="flex items-center gap-1.5 mb-2 text-indigo-600 dark:text-indigo-400 font-bold text-xs uppercase tracking-wider">
                        <span>Medical Insight</span>
                      </div>
                      <p className="text-slate-700 dark:text-slate-200 text-sm leading-relaxed font-medium">
                        Your LDL cholesterol is within optimal range. Maintaining this level reduces cardiovascular risks.
                      </p>
                    </div>
                    <div className="flex justify-between items-center bg-white dark:bg-slate-900 px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm w-full">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">More Details</span>
                      <span className="text-slate-400 text-xs">▼</span>
                    </div>
                  </div>

                </div>
              )}

              {/* ELEMENTS SECTION */}
              {themeActiveSection === 'elements' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl flex flex-col items-center justify-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Primary Button</span>
                    <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm">Action</button>
                  </div>
                  <div className="p-4 rounded-2xl flex flex-col items-center justify-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Secondary Button</span>
                    <button className="bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-4 py-2 rounded-xl text-xs font-semibold transition-all">Secondary</button>
                  </div>
                  <div className="p-4 rounded-2xl flex flex-col items-center justify-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Form Select</span>
                    <select className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 w-32 focus:outline-none">
                      <option>Option 1</option>
                    </select>
                  </div>
                  <div className="p-4 rounded-2xl flex flex-col items-center justify-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Input Text</span>
                    <input type="text" placeholder="Type here" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 w-32 focus:outline-none" />
                  </div>
                  <div className="p-4 rounded-2xl flex flex-col items-center justify-center gap-3 col-span-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Status Badges</span>
                    <div className="flex flex-wrap gap-2 justify-center">
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold border text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/50">Success</span>
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold border text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/50">Warning</span>
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold border text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900/50">Failure</span>
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold border text-slate-600 bg-slate-100 border-slate-200 dark:text-slate-300 dark:bg-slate-800 dark:border-slate-700">Neutral</span>
                    </div>
                  </div>
                  <div className="col-span-2 p-4 rounded-2xl flex flex-col gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase text-center">Paragraph Text</span>
                    <p className="text-sm text-slate-600 dark:text-slate-400 text-center leading-relaxed font-sans">
                      This is a block of standard paragraph text used throughout the application to convey descriptive guidelines.
                    </p>
                  </div>
                </div>
              )}

              {/* PRESETS SECTION */}
              {themeActiveSection === 'presets' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Saved Presets</h4>
                      <div className="flex gap-2">
                        <label className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold transition-all cursor-pointer">
                          Import JSON
                          <input type="file" accept=".json" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              try {
                                const parsed = JSON.parse(ev.target?.result as string);
                                let rawPresets: any[] = [];
                                if (Array.isArray(parsed)) {
                                  rawPresets = parsed;
                                } else if (parsed.preset && Array.isArray(parsed.preset)) {
                                  rawPresets = parsed.preset;
                                } else {
                                  rawPresets = [parsed];
                                }
                                const normalized = rawPresets.map(p => normalizeImportedPreset(p)).filter(Boolean);
                                if (normalized.length > 0) {
                                  const updatedPresets = [...(profile.themePresets || [])];
                                  normalized.forEach(p => {
                                    const existingIdx = updatedPresets.findIndex(x => x.name === p.name);
                                    if (existingIdx >= 0) {
                                      updatedPresets[existingIdx] = p;
                                    } else {
                                      updatedPresets.push(p);
                                    }
                                  });
                                  const lastOne = normalized[normalized.length - 1];
                                  const updatedP = {
                                    ...profile,
                                    themePresets: updatedPresets,
                                    themePalette: lastOne.themePalette !== undefined ? lastOne.themePalette : profile.themePalette,
                                    fontFamily: lastOne.fontFamily || profile.fontFamily,
                                    fontMono: lastOne.fontMono || profile.fontMono,
                                    fontSize: lastOne.fontSize || profile.fontSize,
                                    marginScale: lastOne.marginScale || profile.marginScale,
                                    paddingScale: lastOne.paddingScale || profile.paddingScale,
                                    cornerRadius: lastOne.cornerRadius || profile.cornerRadius,
                                    shadowScale: lastOne.shadowScale || profile.shadowScale,
                                    themeOverrides: lastOne.themeOverrides !== undefined ? lastOne.themeOverrides : profile.themeOverrides,
                                    fontSizeTitle: lastOne.fontSizeTitle || profile.fontSizeTitle,
                                    fontSizeSubtitle: lastOne.fontSizeSubtitle || profile.fontSizeSubtitle,
                                    fontSizeDescription: lastOne.fontSizeDescription || profile.fontSizeDescription,
                                    fontSizeBodySmall: lastOne.fontSizeBodySmall || profile.fontSizeBodySmall,
                                    fontSizeSubtitleSmall: lastOne.fontSizeSubtitleSmall || profile.fontSizeSubtitleSmall,
                                    fontSizeKeyMetric: lastOne.fontSizeKeyMetric || profile.fontSizeKeyMetric,
                                    fontSizeXS: lastOne.fontSizeXS || profile.fontSizeXS,
                                    fontSizeBody: lastOne.fontSizeBody || profile.fontSizeBody,
                                    customColors: lastOne.customColors !== undefined ? lastOne.customColors : profile.customColors,
                                    customFonts: lastOne.customFonts !== undefined ? lastOne.customFonts : profile.customFonts
                                  };
                                  setProfile(updatedP);
                                  if (initialThemeSnapshot.current) {
                                    initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                  }
                                  if (onSaveProfile) onSaveProfile(updatedP);
                                }
                              } catch (err) {
                                console.error('Failed to parse presets', err);
                              }
                            };
                            const inputEl = e.target;
                            reader.onloadend = () => {
                              inputEl.value = '';
                            };
                            reader.readAsText(file);
                          }} />
                        </label>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {(() => {
                        const systemPresetsList = [
                          { name: "System Default", isSystem: true, profileUpdate: { marginScale: undefined, paddingScale: undefined, cornerRadius: undefined, shadowScale: undefined, themePalette: undefined, fontSize: undefined, fontFamily: undefined, fontMono: undefined, fontSizeTitle: undefined, fontSizeSubtitle: undefined, fontSizeDescription: undefined, fontSizeBodySmall: undefined, fontSizeSubtitleSmall: undefined, fontSizeKeyMetric: undefined, fontSizeXS: undefined, fontSizeBody: undefined, themeOverrides: [] } },
                          { name: "Accessible High Contrast (Light)", isSystem: true, profileUpdate: { fontFamily: 'Inter', themePalette: { background: '#ffffff', bgCard: '#ffffff', button: '#0f172a', text: '#0f172a', textSecondary: '#1e293b', border: '#0f172a', textAccent: '#1e40af', textMuted: '#334155', textSuccess: '#166534', textError: '#991b1b', warning: '#9a3412', caution: '#854d0e', success: '#166534', info: '#1e40af', neutralSetting: '#1e293b' } } },
                          { name: "Midnight Blue (Dark)", isSystem: true, profileUpdate: { fontFamily: 'Space Grotesk', themePalette: { background: '#000000', bgCard: '#0f172a', button: '#2563eb', text: '#f8fafc', textSecondary: '#cbd5e1', border: '#1e293b', textAccent: '#a5b4fc', textMuted: '#94a3b8', textSuccess: '#4ade80', textError: '#f87171', warning: '#fb7185', caution: '#fbbf24', success: '#34d399', info: '#60a5fa', neutralSetting: '#cbd5e1' } } },
                          { name: "Emerald Forest (Dark)", isSystem: true, profileUpdate: { fontFamily: 'Outfit', themePalette: { background: '#000000', bgCard: '#06231a', button: '#047857', text: '#ecfdf5', textSecondary: '#a7f3d0', border: '#0f3527', textAccent: '#a5b4fc', textMuted: '#a7f3d0', textSuccess: '#4ade80', textError: '#f87171', warning: '#fb7185', caution: '#fbbf24', success: '#34d399', info: '#60a5fa', neutralSetting: '#d1fae5' } } },
                          { name: "Minimalist White (Light)", isSystem: true, profileUpdate: { fontFamily: 'Playfair Display', themePalette: { background: '#ffffff', bgCard: '#fafafa', button: '#18181b', text: '#09090b', textSecondary: '#52525b', border: '#e4e4e7', textMuted: '#71717a', textSuccess: '#15803d' } } }
                        ];

                        const isSystemPresetActive = systemPresetsList.some(preset => {
                          const effectiveUpdate = profile.systemPresetOverrides?.[preset.name] ? { ...preset.profileUpdate, ...profile.systemPresetOverrides[preset.name] } : preset.profileUpdate;
                          return isPresetActive(effectiveUpdate);
                        });
                        const isUserPresetActive = (profile.themePresets || []).some((preset: any) => isPresetActive(preset));
                        const isAnyPresetActive = isSystemPresetActive || isUserPresetActive;

                        return (
                          <>
                            {!isAnyPresetActive && (
                              <div className="p-3.5 rounded-xl border border-indigo-400 dark:border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/40 ring-2 ring-indigo-500/30 shadow-sm space-y-2.5 transition-all">
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-pulse"></span>
                                    <span className="text-xs font-bold text-indigo-950 dark:text-indigo-100">Custom Theme (Unsaved)</span>
                                  </div>
                                  <span className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                    Applied
                                  </span>
                                </div>
                                <div className="flex gap-2 items-center">
                                  <input
                                    type="text"
                                    value={newPresetName}
                                    onChange={(e) => setNewPresetName(e.target.value)}
                                    placeholder="Enter preset name to save..."
                                    className="flex-1 px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                                  />
                                  <button
                                    disabled={!newPresetName.trim()}
                                    onClick={() => {
                                      const name = newPresetName.trim();
                                      if (!name) return;
                                      const newPreset = {
                                        name,
                                        themePalette: profile.themePalette,
                                        fontSize: profile.fontSize,
                                        fontFamily: profile.fontFamily,
                                        fontMono: profile.fontMono,
                                        marginScale: profile.marginScale,
                                        paddingScale: profile.paddingScale,
                                        cornerRadius: profile.cornerRadius,
                                        shadowScale: profile.shadowScale,
                                        themeOverrides: profile.themeOverrides,
                                        customColors: profile.customColors,
                                        fontSizeTitle: profile.fontSizeTitle,
                                        fontSizeSubtitle: profile.fontSizeSubtitle,
                                        fontSizeDescription: profile.fontSizeDescription,
                                        fontSizeBodySmall: profile.fontSizeBodySmall,
                                        fontSizeSubtitleSmall: profile.fontSizeSubtitleSmall,
                                        fontSizeKeyMetric: profile.fontSizeKeyMetric,
                                        fontSizeXS: profile.fontSizeXS,
                                        fontSizeBody: profile.fontSizeBody,
                                        customFonts: profile.customFonts
                                      };
                                      const updatedP = { ...profile, themePresets: [...(profile.themePresets || []), newPreset] };
                                      setProfile(updatedP);
                                      if (initialThemeSnapshot.current) {
                                        initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                      }
                                      if (onSaveProfile) onSaveProfile(updatedP);
                                      setNewPresetName('');
                                      setJustSavedKey('new-preset');
                                      setTimeout(() => setJustSavedKey(null), 1800);
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all shrink-0 ${
                                      !newPresetName.trim()
                                        ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-400 dark:text-indigo-500 cursor-not-allowed'
                                        : justSavedKey === 'new-preset'
                                        ? 'bg-emerald-600 text-white cursor-default'
                                        : 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                                    }`}
                                  >
                                    {justSavedKey === 'new-preset' ? '✓ Saved' : 'Save Preset'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {systemPresetsList.map((preset, idx) => {
                              const effectiveUpdate = profile.systemPresetOverrides?.[preset.name] ? { ...preset.profileUpdate, ...profile.systemPresetOverrides[preset.name] } : preset.profileUpdate;
                              const active = isPresetActive(effectiveUpdate);
                              return (
                                <div key={idx} className={`flex justify-between items-center p-3 rounded-xl border shadow-sm transition-all ${active ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-500/30' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}>
                                  <div className="flex items-center gap-2 flex-1 truncate mr-2">
                                    {active && (
                                      <span className="w-4 h-4 rounded-full bg-emerald-600 dark:bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs" title="Preset Applied">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                      </span>
                                    )}
                                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{preset.name}</span>
                                  </div>
                                  <div className="flex gap-2 items-center shrink-0">
                                    <button title="Export" onClick={() => {
                                      const exportPayload = buildExportPayload(effectiveUpdate, preset.name);
                                      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
                                      const url = URL.createObjectURL(blob);
                                      const a = document.createElement('a');
                                      a.href = url;
                                      a.download = `${preset.name}_preset.json`;
                                      a.click();
                                    }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 rounded-lg transition-all">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                                    </button>
                                    {preset.name !== 'System Default' && (
                                      <>
                                        <button onClick={() => {
                                          const updatedP = {
                                            ...profile,
                                            systemPresetOverrides: {
                                              ...(profile.systemPresetOverrides || {}),
                                              [preset.name]: {
                                                themePalette: profile.themePalette,
                                                fontSize: profile.fontSize,
                                                fontFamily: profile.fontFamily,
                                                fontMono: profile.fontMono,
                                                marginScale: profile.marginScale,
                                                paddingScale: profile.paddingScale,
                                                cornerRadius: profile.cornerRadius,
                                                shadowScale: profile.shadowScale,
                                                themeOverrides: profile.themeOverrides,
                                                customColors: profile.customColors,
                                                fontSizeTitle: profile.fontSizeTitle,
                                                fontSizeSubtitle: profile.fontSizeSubtitle,
                                                fontSizeDescription: profile.fontSizeDescription,
                                                fontSizeBodySmall: profile.fontSizeBodySmall,
                                                fontSizeSubtitleSmall: profile.fontSizeSubtitleSmall,
                                                fontSizeKeyMetric: profile.fontSizeKeyMetric,
                                                fontSizeXS: profile.fontSizeXS,
                                                fontSizeBody: profile.fontSizeBody,
                                                customFonts: profile.customFonts
                                              }
                                            }
                                          };
                                          setProfile(updatedP);
                                          if (initialThemeSnapshot.current) {
                                            initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                          }
                                          if (onSaveProfile) onSaveProfile(updatedP);
                                          setJustSavedKey('system-update-' + preset.name);
                                          setTimeout(() => setJustSavedKey(null), 1800);
                                        }} className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-semibold border border-emerald-200 dark:border-emerald-800 transition-all">{justSavedKey === 'system-update-' + preset.name ? '✓ Saved' : 'Update'}</button>
                                        {profile.systemPresetOverrides?.[preset.name] && (
                                          <button
                                            type="button"
                                            title="Reset to original preset"
                                            onClick={() => {
                                              const next = { ...(profile.systemPresetOverrides || {}) };
                                              delete next[preset.name];
                                              const updatedP = { ...profile, systemPresetOverrides: next };
                                              setProfile(updatedP);
                                              if (initialThemeSnapshot.current) {
                                                initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                              }
                                              if (onSaveProfile) onSaveProfile(updatedP);
                                            }}
                                            className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg transition-all"
                                          >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {active ? (
                                      <span className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                        Applied
                                      </span>
                                    ) : (
                                      <button onClick={() => {
                                        applyPresetConfig(effectiveUpdate);
                                      }} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold transition-all">Apply Default</button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}

                            {(profile.themePresets || []).map((preset, idx) => {
                              const active = isPresetActive(preset);
                              return (
                              <div key={'user'+idx} className={`flex justify-between items-center p-3 rounded-xl border shadow-sm transition-all ${active ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-500/30' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}>
                                <div className="flex items-center gap-2 flex-1 truncate mr-2">
                                  {active && (
                                    <span className="w-4 h-4 rounded-full bg-emerald-600 dark:bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs" title="Preset Applied">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                    </span>
                                  )}
                                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{preset.name}</span>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                  <button title="Export" onClick={() => {
                                    const exportPayload = buildExportPayload(preset, preset.name);
                                    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `${preset.name || 'theme'}_preset.json`;
                                    a.click();
                                  }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 rounded-lg transition-all">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                                  </button>
                                  <button onClick={() => {
                                    const newPresets = [...(profile.themePresets || [])];
                                    newPresets[idx] = {
                                      ...preset,
                                      themePalette: profile.themePalette,
                                      fontSize: profile.fontSize,
                                      fontFamily: profile.fontFamily,
                                      fontMono: profile.fontMono,
                                      marginScale: profile.marginScale,
                                      paddingScale: profile.paddingScale,
                                      cornerRadius: profile.cornerRadius,
                                      shadowScale: profile.shadowScale,
                                      themeOverrides: profile.themeOverrides,
                                      customColors: profile.customColors,
                                      fontSizeTitle: profile.fontSizeTitle,
                                      fontSizeSubtitle: profile.fontSizeSubtitle,
                                      fontSizeDescription: profile.fontSizeDescription,
                                      fontSizeBodySmall: profile.fontSizeBodySmall,
                                      fontSizeSubtitleSmall: profile.fontSizeSubtitleSmall,
                                      fontSizeKeyMetric: profile.fontSizeKeyMetric,
                                      fontSizeXS: profile.fontSizeXS,
                                      fontSizeBody: profile.fontSizeBody,
                                      customFonts: profile.customFonts
                                    };
                                    const updatedP = { ...profile, themePresets: newPresets };
                                    setProfile(updatedP);
                                    if (initialThemeSnapshot.current) {
                                      initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                    }
                                    if (onSaveProfile) onSaveProfile(updatedP);
                                    setJustSavedKey('user-update-' + idx);
                                    setTimeout(() => setJustSavedKey(null), 1800);
                                  }} className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-semibold border border-emerald-200 dark:border-emerald-800 transition-all">{justSavedKey === 'user-update-' + idx ? '✓ Saved' : 'Update'}</button>
                                  <button onClick={() => {
                                    applyPresetConfig(preset);
                                  }} className={active ? "hidden" : "px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-semibold border border-indigo-200 dark:border-indigo-800 transition-all"}>Apply</button>
                                  {active && (
                                    <span className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                      Applied
                                    </span>
                                  )}
                                  <button onClick={() => {
                                    const newPresets = [...(profile.themePresets || [])];
                                    newPresets.splice(idx, 1);
                                    const updatedP = { ...profile, themePresets: newPresets };
                                    setProfile(updatedP);
                                    if (initialThemeSnapshot.current) {
                                      initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                    }
                                    if (onSaveProfile) onSaveProfile(updatedP);
                                  }} className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-semibold border border-rose-200 dark:border-rose-800 transition-all">Del</button>
                                </div>
                              </div>
                              );
                            })}
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-850 space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Current Theme Status</h4>
                      <span className="text-xs font-semibold text-slate-500 bg-slate-200 dark:bg-slate-800 px-2 py-1 rounded-md">
                        {getThemeVariableChangesCount()} Variable Changes
                      </span>
                    </div>
                    {(() => {
                      const isCurrentConfigSaved = (profile.themePresets || []).some((p: any) => isPresetActive(p));
                      return (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Preset Name</label>
                            <input
                              type="text"
                              value={newPresetName}
                              onChange={(e) => setNewPresetName(e.target.value)}
                              placeholder="e.g. My Custom Theme"
                              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                            />
                          </div>
                          <button 
                            disabled={!newPresetName.trim()}
                            onClick={() => {
                              const name = newPresetName.trim();
                              if (!name) return;
                              const newPreset = {
                                name,
                                themePalette: profile.themePalette,
                                fontSize: profile.fontSize,
                                fontFamily: profile.fontFamily,
                                fontMono: profile.fontMono,
                                marginScale: profile.marginScale,
                                paddingScale: profile.paddingScale,
                                cornerRadius: profile.cornerRadius,
                                shadowScale: profile.shadowScale,
                                themeOverrides: profile.themeOverrides,
                                customColors: profile.customColors,
                                fontSizeTitle: profile.fontSizeTitle,
                                fontSizeSubtitle: profile.fontSizeSubtitle,
                                fontSizeDescription: profile.fontSizeDescription,
                                fontSizeBodySmall: profile.fontSizeBodySmall,
                                fontSizeSubtitleSmall: profile.fontSizeSubtitleSmall,
                                fontSizeKeyMetric: profile.fontSizeKeyMetric,
                                fontSizeXS: profile.fontSizeXS,
                                fontSizeBody: profile.fontSizeBody,
                                customFonts: profile.customFonts
                              };
                              const updatedP = { ...profile, themePresets: [...(profile.themePresets || []), newPreset] };
                              setProfile(updatedP);
                              if (initialThemeSnapshot.current) {
                                initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                              }
                              if (onSaveProfile) onSaveProfile(updatedP);
                              setNewPresetName('');
                              setJustSavedKey('new-preset');
                              setTimeout(() => setJustSavedKey(null), 1800);
                            }} 
                            className={`w-full px-4 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all text-center ${!newPresetName.trim() ? 'bg-slate-100 dark:bg-slate-900 text-slate-400 dark:text-slate-600 cursor-not-allowed' : justSavedKey === 'new-preset' ? 'bg-emerald-600 text-white cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'}`}
                          >
                            {justSavedKey === 'new-preset' ? '✓ Preset Saved' : 'Save Current Configuration as Preset'}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        </>
      ), document.body)}


      {/* Database Interactions Live Sync Overlay */}
      {showDbInteractionsOverlay && createPortal((
        <div id="db-interactions-overlay" className="fixed inset-0 z-[9999] bg-slate-900/75 backdrop-blur-md flex items-center justify-center p-0">
          <div className="bg-white dark:bg-slate-900 w-full h-full shadow-2xl overflow-hidden flex flex-col animation-fade-in text-slate-850 dark:text-slate-100">
            {/* Header */}
            <div className="px-4 sm:px-6 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2.5 shrink-0">
                <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0" />
                <div className="hidden xs:block">
                  <h2 className="text-base sm:text-lg font-bold text-theme-text leading-none">Settings</h2>
                  <span className="text-[10px] sm:text-xs font-normal text-slate-400 block mt-0.5">
                    {(() => {
                      const buildTime = serverStartTime || 1782721085000;
                      const diffMs = Math.max(0, now - buildTime);
                      const diffMins = Math.floor(diffMs / 60000);
                      return diffMins < 1 ? 'last published just now' : `last published ${diffMins} min ago`;
                    })()}
                  </span>
                </div>
              </div>
              
              {/* Horizontal Scrollable admin buttons */}
              <div className="flex-1 flex items-center justify-end gap-2 overflow-x-auto py-1 px-0.5 min-w-0">
                {dbOverlayViewMode === 'admin' && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setShowAgentLogs(true)}
                      className="p-1.5 rounded-lg text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                      title="View AI Agent Logs"
                    >
                      <Terminal className="w-4 h-4" /> <span className="hidden md:inline">View AI Logs</span>
                    </button>
                    <button
                      onClick={() => setIsTrackerOpen(true)}
                      className="p-1.5 rounded-lg text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                      title="View API call stats"
                    >
                      <Cloud className="w-4 h-4" /> <span className="hidden md:inline">API Calls</span>
                    </button>
                    <button
                      onClick={() => setShowNutritionDataBrowser(true)}
                      className="p-1.5 rounded-lg text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-900/30 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                      title="Nutrition data browser — chains, base cache, unfetched, issues"
                    >
                      <Database className="w-4 h-4" /> <span className="hidden md:inline">Nutrition DB</span>
                    </button>
                    <button
                      onClick={() => setShowBugTracker(true)}
                      className="p-1.5 rounded-lg text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-900/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                      title="Bug tracker — shared fix tags across all reports"
                    >
                      <Bug className="w-4 h-4" /> <span className="hidden md:inline">Bug Tracker</span>
                    </button>
                  </div>
                )}
                {onCloudSync && (
                  <button
                    onClick={() => {
                      if (onCloudSync) onCloudSync();
                    }}
                    className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold shrink-0"
                    title="Manual Sync"
                  >
                    <RefreshCw className="w-4 h-4" /> <span className="hidden md:inline">Sync Now</span>
                  </button>
                )}
              </div>

              <div className="shrink-0 flex items-center">
                <button
                  onClick={() => setShowDbInteractionsOverlay(false)}
                  className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer shrink-0 ml-1 flex items-center justify-center font-bold"
                  title="Close Settings"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content area */}
            <div className="p-6 overflow-y-auto space-y-6 text-left flex-1">
              
              {/* Initiative K: bug snapshot kill-switch (admin) */}
              {isAdmin && (
                <BugSnapshotSettingsToggle />
              )}

              {/* Undo & Snapshots Control inside Settings */}
              {onOpenUndo && (
                <div className="p-3.5 bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-800/50 rounded-2xl flex items-center justify-between shadow-xs">
                  <div>
                    <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5 uppercase tracking-wider">
                      <RotateCcw className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>System Undo & Snapshots</span>
                    </h4>
                    <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                      Restore previous profile state and biomarker snapshot history.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDbInteractionsOverlay(false);
                      if (onOpenUndo) onOpenUndo();
                    }}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Undo / Restore</span>
                  </button>
                </div>
              )}
              
              {dbOverlayViewMode === 'admin' && (
                <div className="flex border-b border-slate-200 dark:border-slate-800 pb-px gap-6 mb-4">
                  <button
                    type="button"
                    onClick={() => setActiveAdminTab('sync')}
                    className={`pb-3 text-xs font-bold transition-all border-b-2 relative cursor-pointer ${
                      activeAdminTab === 'sync'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    Sync & Telemetry
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAdminTab('backup')}
                    className={`pb-3 text-xs font-bold transition-all border-b-2 relative cursor-pointer flex items-center gap-1.5 ${
                      activeAdminTab === 'backup'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <Archive className="w-4 h-4" />
                    Backup
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAdminTab('users')}
                    className={`pb-3 text-xs font-bold transition-all border-b-2 relative cursor-pointer flex items-center gap-1.5 ${
                      activeAdminTab === 'users'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    User Management & Quotas
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAdminTab('catalog')}
                    className={`pb-3 text-xs font-bold transition-all border-b-2 relative cursor-pointer flex items-center gap-1.5 ${
                      activeAdminTab === 'catalog'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <Database className="w-4 h-4 text-orange-500" />
                    Food & Venues Catalog
                  </button>
                </div>
              )}

              {dbOverlayViewMode === 'admin' && activeAdminTab === 'catalog' ? (
                <div className="max-h-[75vh] overflow-y-auto p-4">
                  <React.Suspense fallback={<div className="p-4 flex items-center justify-center"><Loader className="w-5 h-5 animate-spin text-slate-400" /></div>}>
                    <FoodCatalogAdminTab />
                  </React.Suspense>
                </div>
              ) : dbOverlayViewMode === 'admin' && activeAdminTab === 'users' ? (
                <React.Suspense fallback={null}>
                  <UserManagementTab />
                </React.Suspense>
              ) : dbOverlayViewMode === 'admin' && activeAdminTab === 'backup' ? (
                <div className="space-y-6 max-h-[75vh] overflow-y-auto pb-8">
                  <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl mx-4 mt-4 space-y-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                        <Archive className="w-4.5 h-4.5 text-indigo-500" />
                        <span>Google Workspace Backups</span>
                      </h4>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <button
                        type="button"
                        onClick={handleOpenBackup}
                        className="p-3 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex flex-col items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer hover:scale-[1.01]"
                      >
                        <CloudUpload className="w-4.5 h-4.5" />
                        <span>Backup Data</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleOpenRestore}
                        className="p-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold rounded-xl text-xs flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer hover:scale-[1.01]"
                      >
                        <CloudDownload className="w-4.5 h-4.5" />
                        <span>Restore Data</span>
                      </button>
                    </div>
                  </div>
                  <React.Suspense fallback={null}>
                  <BackupRestoreTab 
                     profile={profile} 
                     foodLogs={foodLogs || []} 
                     biomarkerHistory={biomarkerHistory || []} 
                     setFoodLogs={setFoodLogs || (() => {})} 
                     setBiomarkerHistory={setBiomarkerHistory || (() => {})} 
                     onSaveAndSync={onSaveAndSync}
                     biomarkers={biomarkers}
                     actions={actions}
                     dailyBenefits={dailyBenefits}
                     report={report}
                  />
                  </React.Suspense>
                  <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 mx-4 mt-4">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-2">
                      <Cloud className="w-5 h-5 text-indigo-400" />
                      Google Workspace Integration
                    </h3>
                    <p className="text-sm text-slate-400 mb-4">
                      Connect your Google account to enable Google Drive backup and sync capabilities for your health data.
                    </p>
                    <React.Suspense fallback={<div className="p-2 flex items-center justify-center"><Loader className="w-4 h-4 animate-spin text-slate-400" /></div>}>
                      <GoogleHealthIntegration profile={profile} />
                    </React.Suspense>
                  </div>
                </div>
              ) : (
                <>
              {/* List of transactions - MOVED TO TOP */}
              <div className="space-y-2 mb-6">
                <div className="flex items-center justify-between">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Sync Transaction Activity Feed
                  </span>
                  <div className="flex items-center gap-2">
                    {profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com' && (
                      <button
                        onClick={() => setShowSyncDiagnostics(true)}
                        className="flex items-center gap-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 rounded-full hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                        title="View / Download full Sync Diagnostics JSON"
                      >
                        <Terminal className="w-3 h-3" /> Diagnostics
                      </button>
                    )}
                    <button
                      onClick={handleCopySyncFeed}
                      className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded-full"
                      title="Copy full sync feed as text"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                      {dbInteractions.length} Total Logs
                    </span>
                  </div>
                </div>

                {dbInteractions.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-450 bg-slate-50 dark:bg-slate-850 rounded-2xl border border-dashed border-slate-250 dark:border-slate-800">
                    No active transactions logged in this session yet. Tapping sync or updating your records will populate this feed.
                  </div>
                ) : (
                  <div className="border border-slate-150 dark:border-slate-800/80 rounded-2xl overflow-hidden max-h-60 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs min-w-[500px]">
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
                                op.type === 'upload' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/25 dark:text-indigo-400' :
                                op.type === 'download' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/25 dark:text-emerald-400' :
                                op.type === 'delete' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/25 dark:text-rose-400' :
                                'bg-amber-50 text-amber-600 dark:bg-amber-950/25 dark:text-amber-400'
                              }`}>
                                {op.type.toUpperCase()}
                              </span>
                            </td>
                            <td className="p-3 font-mono max-w-[180px]" title={op.path}>
                              <span className="block text-[9px] font-bold text-slate-500 mb-0.5">{op.database === 'Supabase' ? 'Supabase' : 'Firebase'}</span>
                              <span className="block text-[10px] font-semibold text-slate-700 dark:text-slate-200 truncate">{getSyncLabel(op.path)}</span>
                              <span className="block text-[8px] text-slate-450 dark:text-slate-550 truncate">{op.path}</span>
                            </td>
                            <td className="p-3 text-right font-mono text-slate-650 dark:text-slate-350">
                              {op.sizeBytes > 0 ? `${op.sizeBytes} B` : '-'}
                            </td>
                            <td className="p-3 text-center">
                              <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                op.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' :
                                op.status === 'pending' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 animate-pulse' :
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

                  {/* Cloud Sync Mode Strategy Select Card */}
                  <div className="p-5 bg-indigo-50/30 dark:bg-slate-800/40 border border-indigo-100/40 dark:border-slate-800 rounded-2xl space-y-3.5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-theme-text flex items-center gap-1.5">
                      <Cloud className="w-4.5 h-4.5 text-indigo-500" />
                      <span>Cloud Sync Mode</span>
                    </h3>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider h-fit shrink-0 ${
                    autoSyncDisabled 
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400' 
                      : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-400'
                  }`}>
                    {autoSyncDisabled ? 'Manual (Local-Only)' : 'Automatic'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => handleToggleAutoSync(false)}
                    className={`p-3.5 rounded-xl border text-xs font-bold text-center transition-all flex flex-col items-center justify-center gap-2 cursor-pointer hover:scale-[1.01] ${
                      !autoSyncDisabled
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm font-extrabold'
                        : 'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-850 text-slate-750 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <RefreshCw className={`w-4 h-4 ${!autoSyncDisabled ? 'animate-spin' : ''}`} />
                    <span>Auto Sync</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleAutoSync(true)}
                    className={`p-3.5 rounded-xl border text-xs font-bold text-center transition-all flex flex-col items-center justify-center gap-2 cursor-pointer hover:scale-[1.01] ${
                      autoSyncDisabled
                        ? 'bg-amber-500 border-amber-500 text-white shadow-sm font-extrabold'
                        : 'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-850 text-slate-750 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <CloudLightning className="w-4 h-4" />
                    <span>Manual Sync Only</span>
                  </button>
                </div>

                {autoSyncDisabled && (
                  <div className="p-3 bg-amber-50/40 dark:bg-amber-950/15 border border-amber-200/20 rounded-xl flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0"></span>
                    <p className="text-[10px] text-amber-800 dark:text-amber-400 leading-normal font-medium">
                      Saving Firestore writes! Tap <strong>"Sync Now"</strong> or the Cloud icon in the header whenever you want to upload changes.
                    </p>
                  </div>
                )}
              </div>



              {/* Sync Diagnostics (cwah-only): view/copy/download the Supabase debug snapshot in-app */}
              {profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com' && (
                <button
                  type="button"
                  onClick={() => setShowSyncDiagnostics(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-slate-200/60 dark:border-slate-800 bg-slate-100 dark:bg-slate-850 text-xs font-bold text-slate-600 dark:text-slate-300"
                >
                  <Terminal className="w-4 h-4" />
                  Sync Diagnostics
                </button>
              )}

              {/* Dedupe Biomarker Logs (cwah-only): run the duplicate-row cleanup in-app instead of curl */}
              {profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com' && (
                <button
                  type="button"
                  onClick={() => setShowDedupeBiomarkerLogs(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-slate-200/60 dark:border-slate-800 bg-slate-100 dark:bg-slate-850 text-xs font-bold text-slate-600 dark:text-slate-300"
                >
                  <Trash2 className="w-4 h-4" />
                  Dedupe Biomarker Logs
                </button>
              )}

              {/* Admin / User View Toggle */}
              {profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com' && (
                <div className="flex bg-slate-100 dark:bg-slate-850 p-1 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setDbOverlayViewMode('user');
                      localStorage.setItem('health_cockpit_admin_mode', 'user');
                    }}
                    className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      dbOverlayViewMode === 'user'
                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-md border border-slate-200/20'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <User className="w-4 h-4" />
                    User View
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDbOverlayViewMode('admin');
                      localStorage.setItem('health_cockpit_admin_mode', 'admin');
                    }}
                    className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      dbOverlayViewMode === 'admin'
                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-md border border-slate-200/20'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    Admin View
                  </button>
                </div>
              )}



              {/* Interaction statistics row */}
              {dbOverlayViewMode === 'admin' && (
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
              )}

              {/* Images Quota */}
              {dbOverlayViewMode === 'admin' && (
                <div className="p-4 bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100/30 rounded-2xl">
                  <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Database Images (5GB Limit)</span>
                  <div className="flex items-end justify-between">
                    <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                      {foodLogs.reduce((acc, log) => acc + (log.imageUrls?.length || 0) + (log.imageUrl ? 1 : 0), 0)} Images
                    </span>
                    <span className="text-xs font-bold text-indigo-600 bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 rounded relative z-10">
                      {(foodLogs.reduce((acc, log) => acc + (log.imageUrl ? log.imageUrl.length : 0) + (log.imageUrls ? log.imageUrls.reduce((sum, img) => sum + img.length, 0) : 0), 0) / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  </div>
                </div>
              )}

              {/* API & Agent Call Tracker section */}
              {dbOverlayViewMode === 'admin' && (
                <button
                  type="button"
                  onClick={() => setIsTrackerOpen(true)}
                  className="w-full text-left p-4 bg-emerald-50/50 hover:bg-emerald-50 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/60 rounded-2xl transition-all cursor-pointer group flex items-center justify-between"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        API & Agent Call Tracker
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block pl-6">
                      View real-time LLM API handshakes, token usage, latency & call logs
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 group-hover:translate-x-0.5 transition-transform">
                    <span>Open Tracker</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </button>
              )}

              {/* AI Agent Live thinking / Debug Logs section */}
              {dbOverlayViewMode === 'admin' && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-2xl space-y-3">
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
                </div>
              )}


                </>
              )}
            </div>

            {/* Footer: Interactive Fail-Proof Granular Sync Dashboard */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {/* Food & Venues */}
                  <div 
                    onClick={() => setSelectedSyncCategory(selectedSyncCategory === 'food' ? null : 'food')}
                    className={`bg-white dark:bg-slate-800 border ${selectedSyncCategory === 'food' ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 dark:border-slate-700'} p-2.5 rounded-xl flex flex-col justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all`}
                  >
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">🍔 Food & Venues</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const total = (foodLogs || []).length;
                        const synced = (foodLogs || []).filter(f => !f?.sync_state || f?.sync_state === 'synced').length;
                        const percent = total > 0 ? Math.round((synced / total) * 100) : 100;
                        const pendingCount = total - synced;
                        const openDeferredGaps = catalogSyncStatus?.open_deferred_gaps || 0;
                        const syncFailures = catalogSyncStatus?.sync_failures || 0;
                        const hasCatalogIssues = openDeferredGaps > 0 || syncFailures > 0;
                        const isFullyGreen = percent === 100 && !hasCatalogIssues;

                        return (
                          <span className={`text-xs font-semibold ${isFullyGreen ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                            {percent}%{' '}
                            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 ml-1">
                              {percent === 100 ? `${total} logs` : `${pendingCount} pending`}
                              {catalogSyncStatus?.food_items && (
                                <span className="ml-1 font-semibold text-indigo-500 dark:text-indigo-400">
                                  ({catalogSyncStatus.food_items.active} active / {catalogSyncStatus.food_items.candidate} candidates / gaps:{openDeferredGaps} / fails:{syncFailures})
                                </span>
                              )}
                            </span>
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Biomarkers */}
                  <div 
                    onClick={() => setSelectedSyncCategory(selectedSyncCategory === 'biomarker' ? null : 'biomarker')}
                    className={`bg-white dark:bg-slate-800 border ${selectedSyncCategory === 'biomarker' ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 dark:border-slate-700'} p-2.5 rounded-xl flex flex-col justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all`}
                  >
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">🩸 Biomarkers</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const total = (biomarkerHistory || []).length;
                        const synced = (biomarkerHistory || []).filter(b => !b?.sync_state || b?.sync_state === 'synced').length;
                        const percent = total > 0 ? Math.round((synced / total) * 100) : 100;
                        const pendingCount = total - synced;
                        const pendingFiles = (biomarkerHistory || [])
                          .filter(b => b?.sync_state && b?.sync_state !== 'synced')
                          .slice(0, 3)
                          .map(b => (b?.id || 'unknown').slice(0, 20))
                          .join(', ');
                        
                        return (
                          <span className={`text-xs font-semibold ${percent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                            {percent}%{' '}
                            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 ml-1">
                              {percent === 100 ? `${total}` : `${pendingCount} pending (${pendingFiles}${pendingCount > 3 ? '...' : ''})`}
                            </span>
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Website / App */}
                  <div 
                    onClick={() => setSelectedSyncCategory(selectedSyncCategory === 'core' ? null : 'core')}
                    className={`bg-white dark:bg-slate-800 border ${selectedSyncCategory === 'core' ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 dark:border-slate-700'} p-2.5 rounded-xl flex flex-col justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all`}
                  >
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">🌐 Core Data</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const isPending = syncState === 'local' && localStorage.getItem('firestore_quota_exceeded') !== 'true';
                        const percent = isPending ? 98 : 100;
                        return (
                          <span className={`text-xs font-semibold ${percent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                            {percent}%{' '}
                            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 ml-1">
                              {percent === 100 ? `1` : `2 pending (profile, metadata)`}
                            </span>
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowDbInteractionsOverlay(false)}
                  className="px-5 py-2 h-fit bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-2xl shadow-sm cursor-pointer transition-all shrink-0"
                >
                  Close Logs
                </button>
              </div>

              {/* Dynamic Sync Details Table */}
              {selectedSyncCategory && (
                <div className="mt-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                  <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {selectedSyncCategory === 'food' ? 'Food & Venues' : selectedSyncCategory === 'biomarker' ? 'Biomarker Logs' : 'Core Data (Website/App)'} Sync Details
                    </span>
                    <button onClick={() => setSelectedSyncCategory(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-200/50">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="max-h-[250px] overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 dark:bg-slate-900/20 text-[10px] font-bold text-slate-500 dark:text-slate-450 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                          <th className="px-4 py-2">ID / File</th>
                          <th className="px-4 py-2">Supabase (Authority)</th>
                          <th className="px-4 py-2">Firebase (Fallback)</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedSyncCategory === 'core' && (
                          <>
                            <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className="px-4 py-2.5 font-mono text-[10px] text-slate-600 dark:text-slate-300">profile.json</td>
                              <td className="px-4 py-2.5"><span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Synced</span></td>
                              <td className="px-4 py-2.5">
                                {localStorage.getItem('firestore_quota_exceeded') === 'true' 
                                  ? <span className="text-rose-500 font-semibold text-[10px] bg-rose-50 dark:bg-rose-950/30 px-1.5 py-0.5 rounded">Quota Exceeded</span>
                                  : <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Synced</span>}
                              </td>
                            </tr>
                            <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className="px-4 py-2.5 font-mono text-[10px] text-slate-600 dark:text-slate-300">metadata.json</td>
                              <td className="px-4 py-2.5"><span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Synced</span></td>
                              <td className="px-4 py-2.5">
                                {localStorage.getItem('firestore_quota_exceeded') === 'true' 
                                  ? <span className="text-rose-500 font-semibold text-[10px] bg-rose-50 dark:bg-rose-950/30 px-1.5 py-0.5 rounded">Quota Exceeded</span>
                                  : <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Synced</span>}
                              </td>
                            </tr>
                          </>
                        )}
                        {(selectedSyncCategory === 'food' ? (foodLogs || []) : selectedSyncCategory === 'biomarker' ? (biomarkerHistory || []) : [])
                          .sort((a, b) => {
                            const aPending = a.sync_state && a.sync_state !== 'synced';
                            const bPending = b.sync_state && b.sync_state !== 'synced';
                            return (aPending === bPending) ? 0 : aPending ? -1 : 1; // Pending first
                          })
                          .map((log: any) => (
                            <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                              <td className="px-4 py-2.5 font-mono text-[10px] text-slate-600 dark:text-slate-300 truncate max-w-[200px]">
                                {log.id || log.date}
                              </td>
                              <td className="px-4 py-2.5">
                                {(!log.sync_state || log.sync_state === 'synced') ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Synced</span>
                                ) : (
                                  <span className="text-amber-500 font-semibold text-[10px] bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded animate-pulse">Pending ({log.sync_state})</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                {(!log.sync_state || log.sync_state === 'synced') ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Synced</span>
                                ) : (
                                  <span className="text-slate-400 font-medium text-[10px]">Awaiting Supabase</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedSyncCategory === 'food' && catalogSyncStatus && (
                    <div className="p-3 bg-slate-50/80 dark:bg-slate-900/40 border-t border-slate-200 dark:border-slate-700 text-xs flex flex-col gap-2">
                      <div className="font-bold text-slate-700 dark:text-slate-200 text-[11px] flex items-center justify-between">
                        <span>Food Catalog Telemetry</span>
                        <span className="text-[10px] font-mono text-slate-500">Active: {catalogSyncStatus.food_items?.active || 0} | Candidates: {catalogSyncStatus.food_items?.candidate || 0} | Gaps: {catalogSyncStatus.open_deferred_gaps || 0}</span>
                      </div>
                      {catalogSyncStatus.latest_sync_events && catalogSyncStatus.latest_sync_events.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-slate-400 uppercase">Recent Catalog Events:</span>
                          {catalogSyncStatus.latest_sync_events.slice(0, 5).map((evt: any, i: number) => (
                            <div key={i} className="text-[10px] font-mono flex items-center justify-between text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700">
                              <span>{evt.event_type}</span>
                              <span className="text-[9px] text-slate-400">{evt.created_at ? new Date(evt.created_at).toLocaleTimeString() : 'just now'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ), document.body)}

      {/* Backup Modal Overlay */}
      {showBackupModal && createPortal((
        <div id="backup-modal-overlay" className="fixed inset-0 z-[10000] bg-slate-900/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animation-fade-in text-slate-800 dark:text-slate-100">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-indigo-50/50 dark:bg-indigo-950/25">
              <div className="flex items-center gap-2.5">
                <CloudUpload className="w-5.5 h-5.5 text-indigo-600 dark:text-indigo-400" />
                <div>
                  <h2 className="text-lg font-bold text-theme-text">Create Secured Cloud Backup</h2>
                  <span className="text-[10px] text-slate-500 font-medium block mt-0.5">Saves all patient logs and metadata in a password-secured ZIP archive</span>
                </div>
              </div>
              <button
                onClick={() => setShowBackupModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Content Area */}
            <div className="p-6 overflow-y-auto space-y-5 text-left flex-1">
              {backupStatus === 'idle' && (
                <form onSubmit={handleExecuteBackup} className="space-y-4">
                  {/* Version */}
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Backup Version Name
                    </label>
                    <input
                      type="text"
                      value={backupVersion}
                      onChange={(e) => setBackupVersion(e.target.value)}
                      placeholder="e.g., V1, V2, V1-initial"
                      className="w-full text-sm px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100"
                      required
                    />
                  </div>

                  {/* Password */}
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                      <span>ZIP Encryption Password</span>
                    </label>
                    <input
                      type="password"
                      value={backupPassword}
                      onChange={(e) => setBackupPassword(e.target.value)}
                      placeholder="Enter a secure password to encrypt files"
                      className="w-full text-sm px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100"
                      required
                    />
                    <p className="text-[10px] text-slate-400 mt-1">This password will be required to decrypt and restore the records.</p>
                  </div>

                  {/* Comment */}
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Backup Comments / Notes
                    </label>
                    <textarea
                      value={backupComment}
                      onChange={(e) => setBackupComment(e.target.value)}
                      placeholder="Add an optional comment to log in the Sheets registry..."
                      rows={3}
                      className="w-full text-sm px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100 resize-none"
                    />
                  </div>

                  {backupError && (
                    <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-250 dark:border-rose-900/30 rounded-2xl flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{backupError}</span>
                    </div>
                  )}

                  <div className="pt-2 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowBackupModal(false)}
                      className="w-1/2 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="w-1/2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer shadow-md"
                    >
                      Execute Secured Backup
                    </button>
                  </div>
                </form>
              )}

              {backupStatus === 'processing' && (
                <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="w-12 h-12 rounded-full border-4 border-indigo-600/25 border-t-indigo-600 animate-spin" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Creating secure cloud backup archive...</h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">Fetching account records, serializing biomarker history, resolving meal photos, compiling spreadsheet, encrypting with AES, and syncing with Google Workspace...</p>
                  </div>
                </div>
              )}

              {backupStatus === 'success' && backupResult && (
                <div className="space-y-5 py-2">
                  <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/25 border border-emerald-250 dark:border-emerald-900/40 rounded-3xl flex items-start gap-3">
                    <div className="p-2 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-2xl shrink-0">
                      <Check className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-400">Secure Backup Completed Successfully!</h3>
                      <p className="text-xs text-emerald-600 dark:text-emerald-500/80 mt-1 font-medium">
                        The encrypted archive has been saved to your Google Drive and logged in the 'Health Cockpit Backup Registry' Sheet.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-2xl space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Archive Metadata & Stats</span>
                    <div className="grid grid-cols-2 gap-4 text-xs font-medium">
                      <div>
                        <span className="text-slate-500 block">Backup Filename</span>
                        <span className="font-mono text-slate-850 dark:text-slate-200 font-semibold">{backupResult.filename}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Accounts Snapped</span>
                        <span className="text-slate-850 dark:text-slate-200 font-bold">{backupResult.stats.accountsCount}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Total Biomarkers</span>
                        <span className="text-slate-850 dark:text-slate-200 font-bold">{backupResult.stats.totalBiomarkers}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Total meal pictures</span>
                        <span className="text-slate-850 dark:text-slate-200 font-bold">{backupResult.stats.totalImages}</span>
                      </div>
                    </div>
                  </div>

                  {/* Individual breakdown list */}
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Individual Accounts Details</span>
                    <div className="divide-y divide-slate-100 dark:divide-slate-850 border border-slate-150 dark:border-slate-850 rounded-2xl overflow-hidden">
                      {backupResult.stats.details?.map((item: any, idx: number) => (
                        <div key={idx} className="p-3 bg-white dark:bg-slate-900 flex justify-between items-center text-xs">
                          <div>
                            <span className="font-bold text-slate-800 dark:text-slate-200 block">{item.nickname}</span>
                            <span className="text-[10px] text-slate-500 block font-mono">{item.email}</span>
                          </div>
                          <div className="text-right space-y-0.5">
                            <span className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400">{item.biomarkers} biomarkers</span>
                            <span className="block text-[10px] text-slate-500">{item.images} photos</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => setShowBackupModal(false)}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer shadow-md"
                  >
                    Close Backup Panel
                  </button>
                </div>
              )}

              {backupStatus === 'error' && (
                <div className="space-y-4 py-2 text-center">
                  <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/45 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Backup Generation Failed</h3>
                    <p className="text-xs text-rose-600 dark:text-rose-400/80 max-w-sm mx-auto">{backupError}</p>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setBackupStatus('idle')}
                      className="w-1/2 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={() => setShowBackupModal(false)}
                      className="w-1/2 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ), document.body)}

      {/* Restore Modal Overlay */}
      {showRestoreModal && createPortal((
        <div id="restore-modal-overlay" className="fixed inset-0 z-[10000] bg-slate-900/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animation-fade-in text-slate-800 dark:text-slate-100">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-indigo-50/50 dark:bg-indigo-950/25">
              <div className="flex items-center gap-2.5">
                <CloudDownload className="w-5.5 h-5.5 text-indigo-600 dark:text-indigo-400" />
                <div>
                  <h2 className="text-lg font-bold text-theme-text">Restore Database Records</h2>
                  <span className="text-[10px] text-slate-500 font-medium block mt-0.5">Restore data structures from Google Drive encrypted ZIP archives</span>
                </div>
              </div>
              <button
                onClick={() => setShowRestoreModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Content Area */}
            <div className="p-6 overflow-y-auto space-y-4 text-left flex-1">
              {restoreStatus === 'listing' && (
                <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="w-12 h-12 rounded-full border-4 border-indigo-600/25 border-t-indigo-600 animate-spin" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Listing Google Drive snapshots...</h3>
                    <p className="text-xs text-slate-500">Querying backup files matching encryption schema from your Drive...</p>
                  </div>
                </div>
              )}

              {restoreStatus === 'downloading' && (
                <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="w-12 h-12 rounded-full border-4 border-indigo-600/25 border-t-indigo-600 animate-spin" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Downloading archive payload...</h3>
                    <p className="text-xs text-slate-500">Retrieving full encrypted snapshot binary from Google Drive safely...</p>
                  </div>
                </div>
              )}

              {restoreStatus === 'restoring' && (
                <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="w-12 h-12 rounded-full border-4 border-indigo-600/25 border-t-indigo-600 animate-spin" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Rebuilding records in Firestore...</h3>
                    <p className="text-xs text-slate-500">Overwriting subcollections, setting biomarkers, and committing batch mutations to Firebase.</p>
                  </div>
                </div>
              )}

              {/* Stage 1: Select Archive file */}
              {restoreStatus === 'idle' && selectedRestoreFile === null && (
                <div className="space-y-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Available Backup Archives</span>
                  {restoreFiles.length === 0 ? (
                    <div className="text-center py-10 text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50">
                      No matching backup archives found in your Google Drive. Ensure you have run a backup first.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {restoreFiles.map((file) => (
                        <button
                          key={file.id}
                          onClick={() => handleSelectRestoreFile(file)}
                          className="w-full text-left p-3.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-between cursor-pointer group transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <Archive className="w-5 h-5 text-indigo-500 group-hover:scale-105 transition-transform" />
                            <div>
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block truncate max-w-[280px]">{file.name}</span>
                              <span className="text-[10px] text-slate-400 block">{new Date(file.createdTime).toLocaleString()}</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100/60 dark:bg-indigo-950/50 px-2 py-1 rounded-lg">Select</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => setShowRestoreModal(false)}
                    className="w-full py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Stage 2: Decrypt with password */}
              {selectedRestoreFile !== null && restoreStatus !== 'preview' && restoreStatus !== 'success' && restoreStatus !== 'restoring' && restoreStatus !== 'downloading' && (
                <form onSubmit={handleLoadAndDecryptBackup} className="space-y-4">
                  <div className="p-3.5 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-150 dark:border-indigo-900/30 rounded-2xl flex items-start gap-2.5 text-xs">
                    <Archive className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-850 dark:text-slate-200 block">Selected Snapshot Archive</span>
                      <span className="font-mono text-slate-500 block mt-0.5">{selectedRestoreFile.name}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Archive Decryption Password</span>
                    </label>
                    <input
                      type="password"
                      value={restorePassword}
                      onChange={(e) => setRestorePassword(e.target.value)}
                      placeholder="Enter the secure password used for this backup"
                      className="w-full text-sm px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100"
                      required
                    />
                  </div>

                  {restoreError && (
                    <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-250 dark:border-rose-900/30 rounded-2xl flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{restoreError}</span>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => handleSelectRestoreFile(null)}
                      className="w-1/2 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                    >
                      Change File
                    </button>
                    <button
                      type="submit"
                      className="w-1/2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer shadow-md"
                    >
                      Decrypt & Load Preview
                    </button>
                  </div>
                </form>
              )}

              {/* Stage 3: Preview list & Target options */}
              {restoreStatus === 'preview' && (
                <div className="space-y-4">
                  <div className="p-4 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-250 dark:border-amber-900/30 rounded-2xl">
                    <span className="text-[10px] font-bold text-amber-800 dark:text-amber-400 uppercase tracking-wider block">Decryption Preview Verified</span>
                    <div className="grid grid-cols-3 gap-3 text-center text-xs mt-2.5 font-bold text-slate-800 dark:text-slate-100">
                      <div className="p-2 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-850 rounded-xl">
                        <span className="text-[10px] text-slate-400 block font-normal">Accounts</span>
                        {restorePreviewData.length}
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-850 rounded-xl">
                        <span className="text-[10px] text-slate-400 block font-normal">Biomarkers</span>
                        {restorePreviewData.reduce((sum, a) => sum + a.biomarkerCount, 0)}
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-850 rounded-xl">
                        <span className="text-[10px] text-slate-400 block font-normal">Images</span>
                        {restorePreviewData.reduce((sum, a) => sum + a.imageCount, 0)}
                      </div>
                    </div>
                  </div>

                  {/* Restorable Accounts Table */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Archive Accounts Contents</span>
                    <div className="border border-slate-150 dark:border-slate-800 rounded-2xl overflow-hidden max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-850">
                      {restorePreviewData.map((item, idx) => (
                        <div key={idx} className="p-3 bg-slate-50/50 dark:bg-slate-950/30 flex justify-between items-center text-xs">
                          <div>
                            <span className="font-bold text-slate-850 dark:text-slate-200 block">{item.nickname}</span>
                            <span className="text-[10px] text-slate-500 block font-mono">{item.email}</span>
                          </div>
                          <div className="text-right text-[10px] text-slate-550 dark:text-slate-400 space-y-0.5">
                            <span className="block font-semibold">{item.biomarkerCount} biomarkers</span>
                            <span className="block">{item.imageCount} images</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Restoration Target Dropdown */}
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Restoration Scope
                    </label>
                    <select
                      value={restoreTargetAccount}
                      onChange={(e) => setRestoreTargetAccount(e.target.value)}
                      className="w-full text-xs px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-850 dark:text-slate-100 font-medium"
                    >
                      <option value="all">Restore All Accounts in Backup File</option>
                      {restorePreviewData.map((item, idx) => (
                        <option key={idx} value={item.email}>
                          Only Restore Specific Account: {item.nickname} ({item.email})
                        </option>
                      ))}
                    </select>
                  </div>

                  {restoreError && (
                    <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-250 dark:border-rose-900/30 rounded-2xl flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{restoreError}</span>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreStatus('idle');
                        setSelectedRestoreFile(null);
                        setRestorePreviewData([]);
                      }}
                      className="w-1/3 py-3.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                    >
                      Go Back
                    </button>
                    <button
                      onClick={handleExecuteRestore}
                      className="w-2/3 py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer shadow-md flex items-center justify-center gap-1.5"
                    >
                      <Unlock className="w-4 h-4" />
                      <span>Execute Restore Operation</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Stage 5: Success */}
              {restoreStatus === 'success' && (
                <div className="space-y-4 py-2 text-center">
                  <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-950/45 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                    <Check className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Database Restored Successfully!</h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">All medical profiles, biomarker logs, actions, and meal logs have been fully recovered in Firestore and local databases.</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowRestoreModal(false);
                      // Refresh dashboard state
                      window.location.reload();
                    }}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                  >
                    Close & Reload Application
                  </button>
                </div>
              )}

              {/* Stage 6: Error */}
              {restoreStatus === 'error' && (
                <div className="space-y-4 py-2 text-center">
                  <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/45 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Restoration Operation Failed</h3>
                    <p className="text-xs text-rose-600 dark:text-rose-400/80 max-w-sm mx-auto">{restoreError}</p>
                  </div>
                  <button
                    onClick={() => {
                      setRestoreStatus('idle');
                      setSelectedRestoreFile(null);
                      setRestorePreviewData([]);
                    }}
                    className="w-full py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                  >
                    Go Back to File Selection
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ), document.body)}

      {isTrackerOpen && (
        <React.Suspense fallback={null}>
          <ApiCallTrackerModal
            isOpen={isTrackerOpen}
            onClose={() => setIsTrackerOpen(false)}
            userEmail={profile?.email || auth.currentUser?.email || 'guest'}
          />
        </React.Suspense>
      )}

      <React.Suspense fallback={null}>
      <NutritionDataBrowserModal
        isOpen={showNutritionDataBrowser}
        onClose={() => setShowNutritionDataBrowser(false)}
      />

      <BugTrackerModal
        isOpen={showBugTracker}
        onClose={() => setShowBugTracker(false)}
        onViewJob={onViewJob}
      />
      <SyncDiagnosticsModal
        isOpen={showSyncDiagnostics}
        onClose={() => setShowSyncDiagnostics(false)}
      />
      <DedupeBiomarkerLogsModal
        isOpen={showDedupeBiomarkerLogs}
        onClose={() => setShowDedupeBiomarkerLogs(false)}
      />
      </React.Suspense>
    </>
  );
}
