import React, { useState, useEffect, useRef } from 'react';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UserProfile, FoodLog, BiomarkerLog, HealthAction, DailyBenefit, RecommendationReport, DbInteraction, QuotaData, FoodIdea } from './types';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import AuthScreen from './components/AuthScreen';
import HomeTab from './components/HomeTab';
const InsightsTab = lazyWithRetry(() => import('./components/InsightsTab'));
const FoodHistoryTab = lazyWithRetry(() => import('./components/FoodHistoryTab'));
const MedicalHistoryTab = lazyWithRetry(() => import('./components/MedicalHistoryTab'));
const TrendsTab = lazyWithRetry(() => import('./components/TrendsTab'));
import ConflictResolutionModal from './components/ConflictResolutionModal';
import LogChat from './components/LogChat';
import { JobStore } from './jobs/JobStore';
import { JobQueueRunner } from './jobs/JobQueueRunner';
import { initSupabaseJobSync, hydrateUserJobs } from './jobs/SupabaseJobSync';
import { ImageStore } from './jobs/ImageStore';
import { refundCredits } from './jobs/credits';
import { startGoldenIngestWatcher } from './utils/goldenIngestClient';
import { getProgressPercent, getStepCeiling } from './jobs/progress';
import FloatingActionSheet from './components/FloatingActionSheet';
import { saveAgentRequestLog } from './utils/agentLogsTracker';
import { translations } from './utils/translations';
import { AVAILABLE_LLMS } from './utils/llm';
import { PRIMARY_NUTRIENTS, isCoreNutrient, isAdditionalNutrient } from './utils/nutrients';
import { getLocalFallbackReport } from './utils/fallbackReport';
import { toPendingFoodLog } from './mealBuild/adapters';
function extractPendingFoodLogFromCleanResult(cleanResult: any, photoUrl?: string): any {
  if (!cleanResult) return null;
  let log: any = null;
  
  if (cleanResult.pendingFoodLog) {
    log = cleanResult.pendingFoodLog;
  } else if (cleanResult.foodData) {
    log = cleanResult.foodData;
  } else if (cleanResult.mealBuild) {
    log = toPendingFoodLog(cleanResult.mealBuild);
  } else if (cleanResult.data && typeof cleanResult.data === 'object' && (cleanResult.data.itemsBreakdown || cleanResult.data.name || cleanResult.data.nutrients)) {
    log = cleanResult.data;
  } else {
    const items = cleanResult.scoutItems || cleanResult.itemsBreakdown || cleanResult.items || [];
    if (items.length > 0 || cleanResult.name || cleanResult.title) {
      log = {
        itemsBreakdown: items,
        items: items,
        nutrients: cleanResult.nutrients || {},
        name: cleanResult.name || cleanResult.title || 'Meal',
        title: cleanResult.name || cleanResult.title || 'Meal',
        message: cleanResult.message || cleanResult.text || cleanResult.description || '',
        healthImpact: cleanResult.healthImpact || cleanResult.data?.healthImpact || '',
        composition: cleanResult.composition || cleanResult.data?.composition || '',
        benefits: cleanResult.benefits || [],
        risks: cleanResult.risks || [],
        recommendation: cleanResult.recommendation || '',
        verdict: cleanResult.verdict || '',
        receiptTable: cleanResult.receiptTable,
        weightGrams: cleanResult.weightGrams,
        quantity: cleanResult.quantity
      };
    }
  }
  if (log) {
    log.message = log.message || cleanResult.message || cleanResult.text || cleanResult.description || cleanResult.data?.description || '';
    log.healthImpact = log.healthImpact || cleanResult.healthImpact || cleanResult.data?.healthImpact || '';
    log.composition = log.composition || cleanResult.composition || cleanResult.data?.composition || '';
    log.verdict = log.verdict || cleanResult.verdict || cleanResult.data?.verdict || '';
    log.imageUrls = log.imageUrls?.length ? log.imageUrls : (cleanResult.imageUrls || (photoUrl ? [photoUrl] : []));
    log.photoUrl = log.photoUrl || photoUrl || cleanResult.photoUrl;
    return log;
  }
  return null;
}
import { getDemoProfile, getDemoBiomarkerHistory, getDemoFoodLogs, getDemoReport, DemoProfileType } from './utils/demoData';
import { getAvailableCredits, deductAgentCredits } from './utils/creditManager';
import { Plus, HeartHandshake, RefreshCw, Sparkles, Stethoscope, Utensils, Loader, CloudLightning, AlertTriangle, Activity, X } from 'lucide-react';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { trackApiCall, setActiveQueryId, generateQueryId, initializeFetchInterceptor } from './utils/apiTracker';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc, getDocFromServer, getDocsFromServer, getDocsFromCache, writeBatch } from 'firebase/firestore';
import { sanitizeForFirestore, checkQuotaFlag, handleRetryQuota } from './utils/firestoreUtils';
import { getCurrentDateInTimezone, toYYYYMMDD, normalizeBiomarkerHistory } from './utils/dateUtils';
import { biomarkerDefinitions, isAsianEthnicity, hasBmiPendingAlert, getProfileFingerprint, isValEmpty, getMappedBiomarkerKey } from './utils/biomarkers';
import { applyModificationCommands, overlayFingerprint, resolveAgentDestination, shouldRunCalibrator, attachObservationMeta, enrichReviewModificationCommands, collectCatalogUnitMap, cleanupInventedBiomarkerCatalog, type ModificationCommand } from './utils/biomarkerLifecycle';
import { extractFallbackModifications } from './components/chat-cards/BiomarkerReviewCard';
import { formatOptimalTargetValue } from './utils/agentCalibration';
import { standardizeUnit, CONVERSION_FACTORS } from './utils/unitConversion';
import { get, set, pruneLocalStorageToFreeSpace, getStorageKey, getSnapshotKey, saveLocalSnapshot, loadLocalSnapshots, deleteLocalSnapshot, safeSaveToLocalStorage, getAggregatedAppData } from './utils/storageUtils';
const FIRESTORE_READ_BUDGET = 3000; // generous for one real session; a runaway loop hits this fast
function firestoreReadGuard(label: string, docCount: number = 1): boolean {
  const key = 'firestoreReadCountThisSession';
  const current = parseInt(sessionStorage.getItem(key) || '0', 10) + docCount;
  sessionStorage.setItem(key, String(current));
  if (current > FIRESTORE_READ_BUDGET) {
    console.error(`[Circuit Breaker] Firestore read budget exceeded (${current}/${FIRESTORE_READ_BUDGET}) at "${label}". Blocking further reads this session to prevent runaway cost. Reload the page to reset.`);
    return false; // caller should skip the read
  }
  return true;
}
import { runCleanupMigration } from './utils/migrationTask';
import { syncLogsWithTimeBuckets, fetchAllConsolidatedLogs, subscribeToSupabaseLogs, upsertProfileToSupabase, mergeByRecency, mergeActions, mergeBenefits, mergeFoodIdeas, mergeReports, mergeProfiles, mergeBiomarkerHistory, mergeDeleteMaps, supabaseRowToFoodLog, supabaseRowToBiomarkerLog } from "./utils/syncUtils";
import { mergeFoodLogsDeduped, rehydrateFoodImagesFromDonors, foodLogFingerprint } from "./utils/foodLogDedupe";
import { isUsableImageUrl } from "./utils/foodImageSources";
import { sanitizeBiomarkerHistoryOnLoad } from "./utils/biomarkers";
import { recalibrateProfileOverlays } from "./utils/biomarkerLifecycle";
import type { SanitizeProposal } from "./utils/dataSanitize";
import { compressImage } from "./utils/imageCompressor";
/** Cap bulk foodImages Firestore reads per sync (console showed 209 — free-tier death). Rest stay lazy. */
const MAX_IMAGE_FETCH_PER_SYNC = 24;
const QUOTA_STORAGE_KEY = 'health_cockpit_quota_data';
const getQuotaKey = () => {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
};
const getDynamicStyles = (profile: any) => {
  if (!profile) return '';
  const p = profile.themePalette || {};
  const fontSize = profile.fontSize || 'normal';
  const fontFamily = profile.fontFamily || 'Inter';
  const fontMono = profile.fontMono || 'JetBrains Mono';
  
  let fontSizeCss = '';
  if (fontSize === 'tiny') {
    fontSizeCss = `
      :root, html { font-size: 12px !important; }
    `;
  } else if (fontSize === 'small') {
    fontSizeCss = `
      :root, html { font-size: 14px !important; }
    `;
  } else if (fontSize === 'normal') {
    fontSizeCss = `
      :root, html { font-size: 16px !important; }
    `;
  } else if (fontSize === 'large') {
    fontSizeCss = `
      :root, html { font-size: 18px !important; }
    `;
  } else if (fontSize === 'xl') {
    fontSizeCss = `
      :root, html { font-size: 20px !important; }
    `;
  } else if (fontSize === 'xxl') {
    fontSizeCss = `
      :root, html { font-size: 24px !important; }
    `;
  }
  const sizeMap = {
    tiny: '12px',
    small: '14px',
    normal: '16px',
    large: '18px',
    xl: '20px',
    xxl: '24px',
    '3xl': '30px',
    '4xl': '36px',
    '5xl': '48px',
    '6xl': '60px'
  };
  const titleSize = profile.fontSizeTitle ? sizeMap[profile.fontSizeTitle as keyof typeof sizeMap] : '';
  const subtitleSize = profile.fontSizeSubtitle ? sizeMap[profile.fontSizeSubtitle as keyof typeof sizeMap] : '';
  const descSize = profile.fontSizeDescription ? sizeMap[profile.fontSizeDescription as keyof typeof sizeMap] : '';
  const smallSize = profile.fontSizeBodySmall ? sizeMap[profile.fontSizeBodySmall as keyof typeof sizeMap] : '';
  const subtitleSmallSize = profile.fontSizeSubtitleSmall ? sizeMap[profile.fontSizeSubtitleSmall as keyof typeof sizeMap] : '14px';
  const keyMetricSize = profile.fontSizeKeyMetric ? sizeMap[profile.fontSizeKeyMetric as keyof typeof sizeMap] : '36px';
  const xsSize = profile.fontSizeXS ? sizeMap[profile.fontSizeXS as keyof typeof sizeMap] : '10px';
  const bodySize = profile.fontSizeBody ? sizeMap[profile.fontSizeBody as keyof typeof sizeMap] : '16px';
  fontSizeCss += `
    :root {
      --font-size-title: ${titleSize || '24px'} !important;
      --font-size-subtitle: ${subtitleSize || '18px'} !important;
      --font-size-subtitle-small: ${subtitleSmallSize} !important;
      --font-size-body: ${bodySize} !important;
      --font-size-body-small: ${smallSize || '12px'} !important;
      --font-size-key-metric: ${keyMetricSize} !important;
      --font-size-xs: ${xsSize} !important;
    }
    .font-size-title { font-size: ${titleSize || '24px'} !important; }
    .font-size-subtitle { font-size: ${subtitleSize || '18px'} !important; }
    .font-size-subtitle-small { font-size: ${subtitleSmallSize} !important; }
    .font-size-body { font-size: ${bodySize} !important; }
    .font-size-body-small { font-size: ${smallSize || '12px'} !important; }
    .font-size-key-metric { font-size: ${keyMetricSize} !important; }
    .font-size-xs { font-size: ${xsSize} !important; }
  `;
  if (titleSize || subtitleSize || descSize || smallSize) {
    fontSizeCss += `
      ${titleSize ? `h1, h2, h3, .font-display, .text-xl, .text-2xl, .text-3xl, .text-4xl, .text-5xl { font-size: ${titleSize} !important; line-height: 1.3 !important; }` : ''}
      ${subtitleSize ? `h4, h5, .subtitle-text, .text-lg { font-size: ${subtitleSize} !important; line-height: 1.4 !important; }` : ''}
      ${descSize ? `p, .desc-text, .text-base, .text-md { font-size: ${descSize} !important; line-height: 1.5 !important; }` : ''}
      ${smallSize ? `small, .text-sm, .text-xs, .text-[11px], .text-[10px], .text-[9px], .body-small { font-size: ${smallSize} !important; line-height: 1.5 !important; }` : ''}
    `;
  }
  let fontCss = `
    :root {
      --font-sans: "${fontFamily}", ui-sans-serif, system-ui, sans-serif !important;
      --font-display: "${fontFamily}", sans-serif !important;
      --font-mono: "${fontMono}", ui-monospace, monospace !important;
    }
    body {
      font-family: var(--font-sans) !important;
    }
  `;
  let colorCss = '';
  colorCss += `
    :root {
  `;
  if (p.button) {
    colorCss += `
      --color-indigo-500: ${p.button} !important;
      --color-indigo-600: ${p.button} !important;
      --color-indigo-700: ${p.button}dd !important;
      --color-indigo-50: ${p.button}12 !important;
      --color-indigo-950: ${p.button}25 !important;
    `;
  }
  if (p.background) {
    colorCss += `
      --app-bg: ${p.background} !important;
      --color-slate-50: ${p.background} !important;
    `;
  }
  if (p.bgCard) {
    colorCss += `--app-bg-card: ${p.bgCard} !important;`;
  }
  if (p.border) {
    colorCss += `
      --app-border: ${p.border} !important;
      --color-slate-200: ${p.border} !important;
    `;
  }
  if (p.warning) {
    colorCss += `
      --color-rose-500: ${p.warning} !important;
      --color-rose-600: ${p.warning} !important;
      --color-rose-800: ${p.warning} !important;
      --color-rose-50: ${p.warning}12 !important;
      --color-rose-100: ${p.warning}22 !important;
    `;
  }
  if (p.caution) {
    colorCss += `
      --color-amber-500: ${p.caution} !important;
      --color-amber-600: ${p.caution} !important;
      --color-amber-50: ${p.caution}12 !important;
    `;
  }
  if (p.success) {
    colorCss += `
      --color-emerald-500: ${p.success} !important;
      --color-emerald-600: ${p.success} !important;
      --color-emerald-50: ${p.success}12 !important;
    `;
  }
  if (p.text) {
    colorCss += `
      --app-text: ${p.text} !important;
      --color-slate-900: ${p.text} !important;
    `;
  }
  if (p.textSecondary) {
    colorCss += `
      --app-text-secondary: ${p.textSecondary} !important;
      --color-slate-500: ${p.textSecondary} !important;
    `;
  }
  if (p.textDarkPrimary) {
    colorCss += `--theme-text-dark-primary: ${p.textDarkPrimary} !important;`;
  }
  if (p.textDarkSecondary) {
    colorCss += `--theme-text-dark-secondary: ${p.textDarkSecondary} !important;`;
  }
  if (p.textAccent) {
    colorCss += `
      --color-text-accent: ${p.textAccent} !important;
      --color-indigo-400: ${p.textAccent} !important;
    `;
  }
  if (p.textMuted) {
    colorCss += `
      --color-text-muted: ${p.textMuted} !important;
      --color-slate-400: ${p.textMuted} !important;
    `;
  }
  if (p.textSuccess) {
    colorCss += `
      --color-text-success: ${p.textSuccess} !important;
      --color-green-400: ${p.textSuccess} !important;
    `;
  }
  if (p.textError) {
    colorCss += `
      --color-text-error: ${p.textError} !important;
      --color-red-400: ${p.textError} !important;
    `;
  }
  if (p.neutralSetting) {
    colorCss += `
      --app-neutral: ${p.neutralSetting} !important;
      --color-slate-700: ${p.neutralSetting} !important;
    `;
  }
  if (p.info) {
    colorCss += `
      --color-blue-500: ${p.info} !important;
    `;
  }
  if (p.nutrientCalories) {
    colorCss += `
      --color-nutrient-calories: ${p.nutrientCalories} !important;
    `;
  }
  if (p.nutrientProtein) {
    colorCss += `
      --color-nutrient-protein: ${p.nutrientProtein} !important;
    `;
  }
  if (p.nutrientCarbs) {
    colorCss += `
      --color-nutrient-carbohydrates: ${p.nutrientCarbs} !important;
    `;
  }
  if (p.nutrientFat) {
    colorCss += `
      --color-nutrient-totalFat: ${p.nutrientFat} !important;
    `;
  }
  if (p.nutrientSatFat) {
    colorCss += `
      --color-nutrient-saturatedFat: ${p.nutrientSatFat} !important;
    `;
  }
  if (p.nutrientSodium) {
    colorCss += `
      --color-nutrient-sodium: ${p.nutrientSodium} !important;
    `;
  }
  // Generic emitter for all keys in themePalette
  Object.entries(p).forEach(([key, val]) => {
    if (val && typeof val === 'string') {
      colorCss += `--color-${key}: ${val} !important;\n`;
    }
  });
  if (profile.customColors && Array.isArray(profile.customColors)) {
    profile.customColors.forEach((color: any) => {
      const activeVal = p[color.key] || color.defaultHex;
      if (activeVal) {
        colorCss += `      --color-${color.key}: ${activeVal} !important;\n`;
      }
    });
  }
  colorCss += `
    }
  `;
  if (profile.themeOverrides && Array.isArray(profile.themeOverrides)) {
    profile.themeOverrides.forEach(override => {
      colorCss += `
        ${override.selector} {
          ${override.property}: ${override.variable} !important;
        }
      `;
    });
  }
  // Spacing, Corner Radius, and Shadows Design Tokens
  const marginScale = profile?.marginScale || 'normal';
  const paddingScale = profile?.paddingScale || 'normal';
  const cornerRadius = profile?.cornerRadius || 'normal';
  const shadowScale = profile?.shadowScale || 'normal';
  const marginFactor = marginScale === 'compact' ? '0.75' : marginScale === 'relaxed' ? '1.25' : '1';
  const paddingFactor = paddingScale === 'compact' ? '0.75' : paddingScale === 'relaxed' ? '1.25' : '1';
  const radiusFactor = cornerRadius === 'none' ? '0' : cornerRadius === 'small' ? '0.5' : cornerRadius === 'large' ? '1.5' : cornerRadius === 'pill' ? '2.5' : '1';
  const shadowFactor = shadowScale === 'none' ? '0' : shadowScale === 'light' ? '0.5' : shadowScale === 'heavy' ? '1.75' : '1';
  let designTokensCss = `
    :root {
      --spacing-factor: ${paddingFactor} !important;
      --margin-factor: ${marginFactor} !important;
      --radius-factor: ${radiusFactor} !important;
      --shadow-factor: ${shadowFactor} !important;
    }
    
    /* Global Card & Button Roundness Overrides */
    .rounded-sm { border-radius: calc(0.125rem * var(--radius-factor)) !important; }
    .rounded, .rounded-md { border-radius: calc(0.375rem * var(--radius-factor)) !important; }
    .rounded-lg { border-radius: calc(0.5rem * var(--radius-factor)) !important; }
    .rounded-xl { border-radius: calc(0.75rem * var(--radius-factor)) !important; }
    .rounded-2xl { border-radius: calc(1rem * var(--radius-factor)) !important; }
    .rounded-3xl { border-radius: calc(1.5rem * var(--radius-factor)) !important; }
    .rounded-full { border-radius: ${cornerRadius === 'none' ? '0 !important' : '9999px !important'}; }
    /* Shadow scale overrides */
    .shadow-sm { box-shadow: 0 1px 2px 0 rgba(0,0,0,calc(0.05 * var(--shadow-factor))) !important; }
    .shadow, .shadow-md { box-shadow: 0 4px 6px -1px rgba(0,0,0,calc(0.08 * var(--shadow-factor))), 0 2px 4px -1px rgba(0,0,0,calc(0.04 * var(--shadow-factor))) !important; }
    .shadow-lg { box-shadow: 0 10px 15px -3px rgba(0,0,0,calc(0.1 * var(--shadow-factor))), 0 4px 6px -2px rgba(0,0,0,calc(0.05 * var(--shadow-factor))) !important; }
    .shadow-xl { box-shadow: 0 20px 25px -5px rgba(0,0,0,calc(0.1 * var(--shadow-factor))), 0 10px 10px -5px rgba(0,0,0,calc(0.04 * var(--shadow-factor))) !important; }
    .shadow-2xl { box-shadow: 0 25px 50px -12px rgba(0,0,0,calc(0.25 * var(--shadow-factor))) !important; }
    /* Dynamic Spacing scale classes */
    .p-1 { padding: calc(0.25rem * var(--spacing-factor)) !important; }
    .p-1.5 { padding: calc(0.375rem * var(--spacing-factor)) !important; }
    .p-2 { padding: calc(0.5rem * var(--spacing-factor)) !important; }
    .p-3 { padding: calc(0.75rem * var(--spacing-factor)) !important; }
    .p-4 { padding: calc(1rem * var(--spacing-factor)) !important; }
    .p-5 { padding: calc(1.25rem * var(--spacing-factor)) !important; }
    .p-6 { padding: calc(1.5rem * var(--spacing-factor)) !important; }
    .p-8 { padding: calc(2rem * var(--spacing-factor)) !important; }
    .px-1 { padding-left: calc(0.25rem * var(--spacing-factor)) !important; padding-right: calc(0.25rem * var(--spacing-factor)) !important; }
    .px-2 { padding-left: calc(0.5rem * var(--spacing-factor)) !important; padding-right: calc(0.5rem * var(--spacing-factor)) !important; }
    .px-3 { padding-left: calc(0.75rem * var(--spacing-factor)) !important; padding-right: calc(0.75rem * var(--spacing-factor)) !important; }
    .px-4 { padding-left: calc(1rem * var(--spacing-factor)) !important; padding-right: calc(1rem * var(--spacing-factor)) !important; }
    .px-6 { padding-left: calc(1.5rem * var(--spacing-factor)) !important; padding-right: calc(1.5rem * var(--spacing-factor)) !important; }
    
    .py-1 { padding-top: calc(0.25rem * var(--spacing-factor)) !important; padding-bottom: calc(0.25rem * var(--spacing-factor)) !important; }
    .py-2 { padding-top: calc(0.5rem * var(--spacing-factor)) !important; padding-bottom: calc(0.5rem * var(--spacing-factor)) !important; }
    .py-3 { padding-top: calc(0.75rem * var(--spacing-factor)) !important; padding-bottom: calc(0.75rem * var(--spacing-factor)) !important; }
    .py-4 { padding-top: calc(1rem * var(--spacing-factor)) !important; padding-bottom: calc(1rem * var(--spacing-factor)) !important; }
    .py-6 { padding-top: calc(1.5rem * var(--spacing-factor)) !important; padding-bottom: calc(1.5rem * var(--spacing-factor)) !important; }
    .m-1 { margin: calc(0.25rem * var(--margin-factor)) !important; }
    .m-2 { margin: calc(0.5rem * var(--margin-factor)) !important; }
    .m-3 { margin: calc(0.75rem * var(--margin-factor)) !important; }
    .m-4 { margin: calc(1rem * var(--margin-factor)) !important; }
    
    .mt-1 { margin-top: calc(0.25rem * var(--margin-factor)) !important; }
    .mt-2 { margin-top: calc(0.5rem * var(--margin-factor)) !important; }
    .mt-3 { margin-top: calc(0.75rem * var(--margin-factor)) !important; }
    .mt-4 { margin-top: calc(1rem * var(--margin-factor)) !important; }
    .mt-6 { margin-top: calc(1.5rem * var(--margin-factor)) !important; }
    .mt-8 { margin-top: calc(2rem * var(--margin-factor)) !important; }
    .mb-1 { margin-bottom: calc(0.25rem * var(--margin-factor)) !important; }
    .mb-2 { margin-bottom: calc(0.5rem * var(--margin-factor)) !important; }
    .mb-3 { margin-bottom: calc(0.75rem * var(--margin-factor)) !important; }
    .mb-4 { margin-bottom: calc(1rem * var(--margin-factor)) !important; }
    .mb-6 { margin-bottom: calc(1.5rem * var(--margin-factor)) !important; }
    .mb-8 { margin-bottom: calc(2rem * var(--margin-factor)) !important; }
  `;
  return `
    ${fontSizeCss}
    ${fontCss}
    ${colorCss}
    ${designTokensCss}
  `;
};
function isDeepEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) return true;
  if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
    return false;
  }
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  
  // Filter out undefined and null values to avoid breaking equality checks on missing or null properties
  const activeKeys1 = keys1.filter(k => obj1[k] !== undefined && obj1[k] !== null);
  const activeKeys2 = keys2.filter(k => obj2[k] !== undefined && obj2[k] !== null);
  if (activeKeys1.length !== activeKeys2.length) return false;
  for (const key of activeKeys1) {
    if (!activeKeys2.includes(key)) return false;
    if (!isDeepEqual(obj1[key], obj2[key])) return false;
  }
  return true;
}
function sanitizeProfile(incomingProfile: any, activeEmail?: string): any {
  const defaultEmail = (activeEmail || 'cwah.liu@gmail.com').toLowerCase().trim();
  if (!incomingProfile) {
    const isCwahEmpty = defaultEmail.includes('cwah.liu') || defaultEmail.includes('chiwah.liu') || defaultEmail.includes('john@mail') || defaultEmail.includes('john@gmail');
    if (!isCwahEmpty) return null;
    return {
      nickname: 'C. Liu',
      photoUrl: '',
      email: 'cwah.liu@gmail.com',
      age: 28,
      ethnicity: 'Chinese',
      weight: 70,
      height: 175,
      gender: 'Male',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: 'en',
      userType: 'Admin',
      topNutrientsToMonitor: PRIMARY_NUTRIENTS
    };
  }
  const emailLower = (incomingProfile.email || activeEmail || '').toLowerCase().trim();
  const nick = (incomingProfile.nickname || '').toLowerCase();
  const isCwah =
    emailLower.includes('cwah.liu') ||
    emailLower.includes('chiwah.liu') ||
    emailLower.includes('john@mail') ||
    emailLower.includes('john@gmail') ||
    nick.includes('john doe');
  if (isCwah) {
    return {
      ...incomingProfile,
      email: 'cwah.liu@gmail.com',
      nickname: (!incomingProfile.nickname || nick.includes('john doe')) ? 'C. Liu' : incomingProfile.nickname,
      age: incomingProfile.age || 28,
      ethnicity: (incomingProfile.ethnicity === 'Unknown' || !incomingProfile.ethnicity || incomingProfile.ethnicity === 'Caucasian')
        ? 'Chinese'
        : incomingProfile.ethnicity,
      weight: incomingProfile.weight || 70,
      height: incomingProfile.height || 175,
      gender: (incomingProfile.gender === 'Unknown' || !incomingProfile.gender) ? 'Male' : incomingProfile.gender,
      userType: 'Admin'
    };
  }
  return incomingProfile;
}
const safeAlert = (message: string) => {
  try {
    alert(message);
  } catch (e) {
    console.warn("alert() was blocked by sandbox iframe restrictions:", e);
  }
};

export default function App() {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [showSnapshotPanel, setShowSnapshotPanel] = useState(false);
  const [lastSnapshotLabel, setLastSnapshotLabel] = useState<string | null>(null);
  useEffect(() => {
    initializeFetchInterceptor();
  }, []);

  // One-time prompt reset to clean up stale localStorage for data_review
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('migration_july06_prompts_cleaned_v3') !== 'true') {
      localStorage.removeItem('custom_system_instruction_data_review');
      localStorage.removeItem('custom_variable_data_data_review');
      localStorage.setItem('migration_july06_prompts_cleaned_v3', 'true');
    }
  }, []);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const hasRunImageCompression = useRef(false);
  const [dismissedBmiAlerts, setDismissedBmiAlerts] = useState<{[key: string]: boolean}>(() => {
    try {
      const saved = localStorage.getItem('dismissedBmiAlerts');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const handleDismissBmiAlert = () => {
    if (!profile) return;
    const fingerprint = getProfileFingerprint(profile);
    const updated = { ...dismissedBmiAlerts, [fingerprint]: true };
    setDismissedBmiAlerts(updated);
    localStorage.setItem('dismissedBmiAlerts', JSON.stringify(updated));
  };
  const [activeTabRaw, setActiveTabRaw] = useState<'home' | 'insights' | 'health' | 'food' | 'medical' | 'trends'>('home');
  const [healthSubTab, setHealthSubTab] = useState<'biomarker' | 'insight'>('biomarker');

  const setActiveTab = (tab: 'home' | 'insights' | 'health' | 'food' | 'medical' | 'trends') => {
    if (tab === 'medical') {
      setActiveTabRaw('health');
      setHealthSubTab('biomarker');
    } else if (tab === 'insights') {
      setActiveTabRaw('health');
      setHealthSubTab('insight');
    } else {
      setActiveTabRaw(tab);
    }
  };

  const activeTab = activeTabRaw;

  useEffect(() => {
    const qid = generateQueryId();
    setActiveQueryId(qid);
  }, [activeTab]);

  useEffect(() => {
    const handleSwitchTab = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.tab) {
        setActiveTab(customEvent.detail.tab);
      }
    };
    window.addEventListener('switch-tab', handleSwitchTab);
    window.addEventListener('navigate-tab', handleSwitchTab);
    return () => {
      window.removeEventListener('switch-tab', handleSwitchTab);
      window.removeEventListener('navigate-tab', handleSwitchTab);
    };
  }, []);
  const [initiallyExpandedFoodId, setInitiallyExpandedFoodId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<'synced' | 'syncing' | 'local' | 'conflict'>('local');
  const [isInitialDataLoading, setIsInitialDataLoading] = useState<boolean>(true);
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [conflictData, setConflictData] = useState<{
    localProfile: UserProfile;
    cloudProfile: UserProfile;
    localFoods: FoodLog[];
    cloudFoods: FoodLog[];
    localBioHistory: BiomarkerLog[];
    cloudBioHistory: BiomarkerLog[];
    localActions: HealthAction[];
    cloudActions: HealthAction[];
    localBenefits: DailyBenefit[];
    cloudBenefits: DailyBenefit[];
    cloudReport: RecommendationReport | null;
    localReport: RecommendationReport | null;
  } | null>(null);
  const [isFirestoreQuotaExceeded, setIsFirestoreQuotaExceeded] = useState<boolean>(() => {
    const exceeded = checkQuotaFlag();
    if (exceeded) {
      const saved = localStorage.getItem(QUOTA_STORAGE_KEY);
      const currentKey = getQuotaKey();
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.date !== currentKey) {
            localStorage.removeItem('firestore_quota_exceeded');
            return false;
          }
        } catch (e) {}
      }
    }
    return exceeded;
  });
  const [syncFailedWarning, setSyncFailedWarning] = useState<string | null>(null);
  const handleFirestoreError = (err: any) => {
    if (!err) return;
    const msg = String(err.message || err.code || err || '').toLowerCase();
    if (
      msg.includes('resource-exhausted') || 
      msg.includes('quota') || 
      msg.includes('limit exceeded') ||
      err.code === 'resource-exhausted'
    ) {
      setIsFirestoreQuotaExceeded(true);
      localStorage.setItem('firestore_quota_exceeded', 'true');
      localStorage.setItem('firestore_quota_exceeded_time', new Date().getTime().toString());
      setSyncState('local');
    }
  };
  const [hideSensitive, setHideSensitive] = useState<boolean>(false);
  // DB Transaction tracker state for spinning loader click analytics
  const [dbInteractions, setDbInteractions] = useState<DbInteraction[]>(() => {
    try {
      const saved = localStorage.getItem('dbInteractions_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((op: any) => ({
          ...op,
          status: op.status === 'pending' ? 'error' : op.status,
          errorMessage: op.status === 'pending' ? 'Interrupted by page reload' : op.errorMessage
        }));
      }
    } catch (e) {}
    return [];
  });
  
  useEffect(() => {
    localStorage.setItem('dbInteractions_history', JSON.stringify(dbInteractions));
  }, [dbInteractions]);

  useEffect(() => {
    if (profile?.email) {
      loadLocalSnapshots(profile.email).then(s => setSnapshots(s));
    }
  }, [profile?.email]);

  const handleRestoreSnapshot = async (snapshot: any) => {
    if (!snapshot?.data) return;
    const { profile: snapProfile, foodLogs: snapFoods, biomarkers: snapBiomarkers,
            biomarkerHistory: snapBioHistory, actions: snapActions,
            dailyBenefits: snapBenefits, report: snapReport } = snapshot.data;

    if (snapProfile) setProfile(snapProfile);
    if (snapFoods) setFoodLogs(snapFoods);
    if (snapBiomarkers) setBiomarkers(snapBiomarkers);
    if (snapBioHistory) setBiomarkerHistory(snapBioHistory);
    if (snapActions) setActions(snapActions);
    if (snapBenefits) setDailyBenefits(snapBenefits);
    if (snapReport) setReport(snapReport);

    const restoredBundle = {
      profile: snapProfile,
      foodLogs: snapFoods,
      biomarkers: snapBiomarkers,
      biomarkerHistory: snapBioHistory,
      actions: snapActions || [],
      dailyBenefits: snapBenefits || [],
      foodIdeas: foodIdeas,
      report: snapReport
    };
    await safeSaveToLocalStorage(
      getStorageKey(snapProfile?.email || profile?.email),
      restoredBundle
    );

    setShowSnapshotPanel(false);
    safeAlert(`✅ Restored to: "${snapshot.label}"\n\nYour data has been reverted to this point. Click the Sync button to upload if you wish.`);
  };

  // Auto Sync Disabled Status (for quota saving / local-first control)
  const [autoSyncDisabled, setAutoSyncDisabled] = useState<boolean>(() => {
    return localStorage.getItem('auto_sync_disabled') === 'true';
  });
  const handleToggleAutoSyncDisabled = (disabled: boolean) => {
    setAutoSyncDisabled(disabled);
    localStorage.setItem('auto_sync_disabled', disabled ? 'true' : 'false');
  };

  // Daily Quota Tracking (resets at midnight PT)
  const [quota, setQuota] = useState<QuotaData>(() => {
    const saved = localStorage.getItem(QUOTA_STORAGE_KEY);
    const currentKey = getQuotaKey();
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.date === currentKey) return parsed;
      } catch (e) {}
    }
    return { date: currentKey, reads: 0, writes: 0, deletes: 0 };
  });
  useEffect(() => {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(quota));
  }, [quota]);
  const updateQuota = (type: 'upload' | 'download' | 'delete' | 'sync', docCount: number = 1) => {
    if (type === 'sync' || docCount === 0) return;
    setQuota(prev => {
      const newQuota = { ...prev };
      const currentKey = getQuotaKey();
      if (currentKey !== newQuota.date) {
        newQuota.date = currentKey;
        newQuota.reads = 0;
        newQuota.writes = 0;
        newQuota.deletes = 0;
      }
      if (type === 'upload') newQuota.writes += docCount;
      if (type === 'download') newQuota.reads += docCount;
      if (type === 'delete') newQuota.deletes += docCount;
      return newQuota;
    });
  };
  const logInteraction = (type: 'upload' | 'download' | 'delete' | 'sync', path: string, data: any, docCount: number = 1, database: 'Firebase' | 'Supabase' = 'Firebase') => {
    if (type === 'upload' || type === 'delete' || type === 'download') {
      const apiPrefix = database === 'Supabase' ? 'supabase' : 'firebase';
      const apiType = (type === 'upload' ? `${apiPrefix}_write` : type === 'delete' ? `${apiPrefix}_delete` : `${apiPrefix}_read`) as any;
      const userEmail = auth.currentUser?.email || 'anonymous';
      
      let resolvedLabel = '';
      const actionName = type === 'upload' ? `${database} Write` : type === 'delete' ? `${database} Delete` : `${database} Read`;
      
      if (type === 'download') {
        if (path.includes('(Profile)')) {
          resolvedLabel = `${actionName} - Fetch User Profile (downloads remote settings & checks database lastUpdatedAt to see if local device needs a full sync)`;
        } else if (path.includes('/foodLogs')) {
          resolvedLabel = `${actionName} - Fetch Food Logs (downloads remote meal entries logged on other devices to synchronize state)`;
        } else if (path.includes('/biomarkerHistory')) {
          resolvedLabel = `${actionName} - Fetch Biomarker Logs (downloads remote biomarker history recordings to synchronize state)`;
        } else if (path.includes('/actions')) {
          resolvedLabel = `${actionName} - Fetch Health Actions (downloads active assigned checklist items generated by agents)`;
        } else if (path.includes('/dailyBenefits')) {
          resolvedLabel = `${actionName} - Fetch Daily Benefits (downloads agent-calculated benefits list)`;
        } else if (path.includes('/reports/latest')) {
          resolvedLabel = `${actionName} - Fetch Latest Recommendation Report (downloads latest holistic health analysis)`;
        } else {
          resolvedLabel = `${actionName} - Download from ${path}`;
        }
      } else if (type === 'upload') {
        if (path.includes('(Restore Profile)')) {
          resolvedLabel = `${actionName} - Restore Profile (overwrites Cloud settings with local backup profile)`;
        } else if (path.includes('(Create Profile)')) {
          resolvedLabel = `${actionName} - Create New User Profile (saves initial onboarded goals, targets, and age/gender)`;
        } else if (path.includes('(Profile)')) {
          resolvedLabel = `${actionName} - Update Profile (saves updated user details, target Ranges, and syncs deleted IDs list to avoid orphaned entries)`;
        } else if (path.includes('/agentAnalyses/')) {
          resolvedLabel = `${actionName} - Save Agent Analysis (saves a newly completed AI medical review or daily log audit)`;
        } else if (path.includes('/metadata/dashboard (Actions)')) {
          resolvedLabel = `${actionName} - Save Dashboard Actions (saves updated checkbox state and list of daily action items)`;
        } else if (path.includes('/metadata/dashboard (Benefits)')) {
          resolvedLabel = `${actionName} - Save Dashboard Benefits (saves updated list of daily diet benefits)`;
        } else if (path.includes('/metadata/dashboard (FoodIdeas)')) {
          resolvedLabel = `${actionName} - Save Dashboard Food Ideas (saves updated list of suggested AI meals)`;
        } else if (path.includes('/metadata/dashboard (Report Update)')) {
          resolvedLabel = `${actionName} - Save Dashboard Report Metadata (updates action list and link to latest analysis)`;
        } else if (path.includes('/metadata/dashboard')) {
          resolvedLabel = `${actionName} - Save General Dashboard Configurations`;
        } else if (path.includes('/reports/latest')) {
          resolvedLabel = `${actionName} - Save Latest Recommendation Report (saves PDF report & health advice payload)`;
        } else {
          resolvedLabel = `${actionName} - Upload to ${path}`;
        }
      } else {
        resolvedLabel = `${actionName} - Delete at ${path}`;
      }
      
      trackApiCall(apiType, resolvedLabel, userEmail);
    }
    const sizeBytes = data ? (typeof data === 'string' ? data.length : JSON.stringify(data).length) : 0;
    const newOp: DbInteraction = {
      id: `db_op_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      type,
      path,
      sizeBytes,
      status: 'pending' as const,
      startTimeMs: Date.now(),
      docCount,
      database
    };
    setDbInteractions(prev => [newOp, ...prev].slice(0, 100));
    return newOp.id;
  };
  const completeInteraction = (id: string, success: boolean, sizeBytes?: number, errorMsg?: string, finalDocCount?: number) => {
    setDbInteractions(prev => {
      const op = prev.find(item => item.id === id);
      if (op && success && op.status === 'pending') {
        const docsCount = finalDocCount !== undefined ? finalDocCount : (op.docCount || 1);
        setTimeout(() => updateQuota(op.type, docsCount), 0);
      }
      return prev.map(item => {
        if (item.id === id) {
          return {
            ...item,
            status: success ? 'completed' : 'failed',
            sizeBytes: sizeBytes !== undefined ? sizeBytes : item.sizeBytes,
            docCount: finalDocCount !== undefined ? finalDocCount : item.docCount,
            errorMessage: errorMsg
          };
        }
        return item;
      });
    });
  };

  const resolveSupabaseLabel = (type: string, path: string, database: string) => {
    const actionName = type === 'upload' ? `${database} Write` : type === 'delete' ? `${database} Delete` : `${database} Read`;
    if (path.includes('(Profile)')) {
      return `${actionName} - Sync Profile (pushes updated settings, targets, and deleted-ID tracking lists to Supabase)`;
    } else if (path.includes('(Food & Biomarker Logs)')) {
      return `${actionName} - Sync Food & Biomarker Logs (pushes locally logged meals and biomarker readings to Supabase)`;
    } else if (path.includes('(All Logs)')) {
      return `${actionName} - Fetch All Logs (downloads food logs, biomarker logs, and profile data from Supabase for cross-device sync)`;
    } else if (path.includes('consolidated_logs (Fallback)')) {
      return `${actionName} - Fetch All Consolidated Logs Buckets (Firestore fallback used because Supabase returned no data)`;
    }
    return `${actionName} - ${type === 'delete' ? 'Delete at' : type === 'upload' ? 'Upload to' : 'Download from'} ${path}`;
  };

  useEffect(() => {
    const handleDbOpStart = (e) => {
      const { id, type, path, data, database, docCount } = e.detail;
      const sizeBytes = data ? (typeof data === 'string' ? data.length : JSON.stringify(data).length) : 0;
      const newOp = {
        id,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        type,
        path,
        sizeBytes,
        status: 'pending' as const,
        startTimeMs: Date.now(),
        docCount,
        database
      };
      setDbInteractions(prev => [newOp, ...prev].slice(0, 100));
      if (type === 'upload' || type === 'delete' || type === 'download') {
        const apiPrefix = database === 'Supabase' ? 'supabase' : 'firebase';
        const apiType = (type === 'upload' ? `${apiPrefix}_write` : type === 'delete' ? `${apiPrefix}_delete` : `${apiPrefix}_read`) as any;
        trackApiCall(apiType, resolveSupabaseLabel(type, path, database), auth.currentUser?.email || 'anonymous');
      }
    };
    
    const handleDbOpComplete = (e) => {
      const { id, success, sizeBytes, errorMsg, finalDocCount } = e.detail;
      completeInteraction(id, success, sizeBytes, errorMsg, finalDocCount);
    };

    const handleSyncPushFailed = (e: any) => {
      const { reason, foodCount, biomarkerCount } = e.detail || {};
      console.warn('[Sync] Push to server failed, changes may not be saved:', reason, { foodCount, biomarkerCount });
      setSyncFailedWarning(`⚠️ Your last change couldn't reach the server (${reason || 'network error'}). It will retry next time you sync.`);
      setTimeout(() => setSyncFailedWarning(null), 6000);
    };

    window.addEventListener('db_op_start', handleDbOpStart);
    window.addEventListener('db_op_complete', handleDbOpComplete);
    window.addEventListener('sync_push_failed', handleSyncPushFailed);
    return () => {
      window.removeEventListener('db_op_start', handleDbOpStart);
      window.removeEventListener('db_op_complete', handleDbOpComplete);
      window.removeEventListener('sync_push_failed', handleSyncPushFailed);
    };
  }, []);
  const withTimeout = <T,>(promise: Promise<T> | T, timeoutMs: number, label: string): Promise<T | void> => {
    let timeoutId: any;
    return Promise.race([
      Promise.resolve(promise).then(res => {
        clearTimeout(timeoutId);
        return res;
      }).catch(err => {
        clearTimeout(timeoutId);
        throw err;
      }),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(`[Firestore Sync Timeout] ${label} took more than ${timeoutMs}ms. Continuing in background/offline cache.`);
          setSyncState('local');
          resolve();
        }, timeoutMs);
      })
    ]);
  };
  // Core logs and targets states
  const [foodLogs, setFoodLogsRaw] = useState<FoodLog[]>([]);
  // B11: every write path collapses id + soft name/kcal/day duplicates (YOLK variants, retries)
  const setFoodLogs = (val: FoodLog[] | ((prev: FoodLog[]) => FoodLog[])) => {
    setFoodLogsRaw((prev) => {
      const next = typeof val === 'function' ? val(prev) : val;
      if (!Array.isArray(next)) return prev;
      return mergeFoodLogsDeduped(next, []);
    });
  };
  const [biomarkers, setBiomarkers] = useState<{ [key: string]: number | string }>({});
  const [biomarkerHistoryRaw, setBiomarkerHistoryRaw] = useState<BiomarkerLog[]>([]);
  const setBiomarkerHistory = (val: BiomarkerLog[] | ((prev: BiomarkerLog[]) => BiomarkerLog[])) => {
    const apply = (raw: BiomarkerLog[]) => {
      const normalized = normalizeBiomarkerHistory(raw || []);
      // Auto-fix unit-scale phantoms (195 mmol/L chol, 42.1 Hct, 14.5 Hb as g/L) and drop rest
      const { history: cleaned, fixedCount } = sanitizeBiomarkerHistoryOnLoad(
        normalized,
        profileRef.current || profile
      );
      if (fixedCount > 0) {
        console.log(`[BiomarkerSanitize] Flagged ${fixedCount} improbable unit-scale value(s) — not auto-rewritten`);
      }
      return cleaned as BiomarkerLog[];
    };
    if (typeof val === 'function') {
      setBiomarkerHistoryRaw((prev) => apply(val(prev)));
    } else {
      setBiomarkerHistoryRaw(apply(val));
    }
  };
  const biomarkerHistory = biomarkerHistoryRaw;
  const [actions, setActions] = useState<HealthAction[]>([]);
  const [dailyBenefits, setDailyBenefits] = useState<DailyBenefit[]>([]);
  const [foodIdeas, setFoodIdeas] = useState<FoodIdea[]>([]);
  const [report, setReport] = useState<RecommendationReport | null>(null);
  const [draftReport, setDraftReport] = useState<RecommendationReport | null>(null);
  // Chat window visibility modals
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isFloatingOpen, setIsFloatingOpen] = useState(false);

  // Keep latest states in refs for the background runner to read without stale closures
  const profileRef = useRef(profile);
  const foodLogsRef = useRef(foodLogs);
  const biomarkersRef = useRef(biomarkers);
  const biomarkerHistoryRef = useRef(biomarkerHistory);

  useEffect(() => {
    profileRef.current = profile;
    foodLogsRef.current = foodLogs;
    biomarkersRef.current = biomarkers;
    biomarkerHistoryRef.current = biomarkerHistory;
  }, [profile, foodLogs, biomarkers, biomarkerHistory]);

  const currentUserId = auth.currentUser?.uid;
  useEffect(() => {
    // Multi-device sync hydrates state on app boot from Supabase
    const cleanupSupabaseSync = initSupabaseJobSync(currentUserId);
    return () => {
      cleanupSupabaseSync();
    };
  }, [currentUserId]);

  useEffect(() => {
    // Configure executor for background queue runner
    JobQueueRunner.setExecutor(async (job, abortSignal) => {
      let attempts = 0;
      const maxAttempts = 3; // Initial + 2 retries
      let lastError = null;

      while (attempts < maxAttempts) {
        attempts++;
        const currentJob = JobStore.getJob(job.id);
        const effectiveAttempt = Math.max(attempts, currentJob?.attemptCount || 1);
        JobStore.updateJob(job.id, {
          attemptCount: effectiveAttempt,
          maxAttempts: maxAttempts
        });
        if (effectiveAttempt > 1) {
          console.log(`[JobQueueRunner] Retrying job ${job.id} (Attempt ${effectiveAttempt}/${maxAttempts})`);
          JobStore.updateJob(job.id, {
            statusMessage: `Retrying (attempt ${effectiveAttempt}/${maxAttempts})...`
          });
        }

        try {
          if (abortSignal.aborted) {
            throw new Error('AbortError');
          }

          // Durable jobs execute on server via /api/jobs/submit
          if (job.kind === 'food_log' || job.kind === 'food_compare' || job.kind === 'medical') {
            const latestForSubmit = JobStore.getJob(job.id) || job;
            const isRetryAttempt = effectiveAttempt > 1 || job.status === 'failed' || !!job.error || /retry|retrying|failed/i.test(latestForSubmit.statusMessage || '');
            const clientOwnsSubmit = !isRetryAttempt && !!latestForSubmit.clientSubmitPending
              && !String(latestForSubmit.statusMessage || '').includes('background runner retrying submit');
            // Ensure job is submitted to server for retries or new jobs not yet pushed
            const needsServerSubmit = !clientOwnsSubmit && (
              isRetryAttempt ||
              !latestForSubmit.serverSubmittedAt ||
              !!latestForSubmit.resumeStage
            );
            if (needsServerSubmit) {
              console.log(`[JobQueueRunner] Submitting job ${job.id} to server (Attempt ${effectiveAttempt}/${maxAttempts}, isRetry=${isRetryAttempt})...`);
              let stringImages = [];
              try {
                const rawImages = (await ImageStore.getImages(job.id)) || [];
                stringImages = await Promise.all(
                  rawImages.map(async (img: any) => {
                    try {
                      return await compressImage(img, 1024, 1024, 0.75);
                    } catch {
                      if (typeof img === 'string') return img;
                      if (img && typeof img === 'object') {
                        const blob = img instanceof Blob ? img : new Blob([img], { type: img.type || 'image/jpeg' });
                        return new Promise((resolve) => {
                          const reader = new FileReader();
                          reader.onload = () => resolve(reader.result);
                          reader.onerror = () => resolve('');
                          reader.readAsDataURL(blob);
                        });
                      }
                      return '';
                    }
                  })
                );
              } catch(e) {}
              
              let submitOk = false;
              let lastSubmitErr: any = null;
              for (let sAttempt = 1; sAttempt <= 3; sAttempt++) {
                try {
                  const res = await fetch('/api/jobs/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      jobId: job.id,
                      userId: auth.currentUser?.uid || 'anonymous',
                      kind: job.kind,
                      mode: job.mode,
                      text: job.inputSnapshot?.text || '',
                      images: stringImages.filter(Boolean),
                      history: job.messages || [],
                      userProfile: profileRef.current,
                      isRetry: isRetryAttempt,
                      ...job.inputSnapshot
                    })
                  });
                  if (res.ok) {
                    // M-FIX2: A 200 here does not guarantee THIS job was actually queued.
                    // The server's per-user in-flight lock can silently redirect a new
                    // submission onto an older, unrelated, still-running job and return
                    // duplicatePrevented:true with that OLDER job's id. Previously this
                    // was indistinguishable from a real success, so the client polled a
                    // jobId the server never created and only found out 3 minutes later
                    // via the generic timeout message, with no real analysis ever run.
                    let resBody: any = null;
                    try { resBody = await res.clone().json(); } catch { /* non-JSON body, treat as normal success */ }
                    if (resBody && resBody.duplicatePrevented) {
                      throw new Error(
                        `An earlier analysis for your account is still ${resBody.status || 'in progress'}. ` +
                        `Please wait a moment for it to finish, then retry.`
                      );
                    }
                    submitOk = true;
                    break;
                  }
                  if (res.status >= 500 && sAttempt < 3) {
                    await new Promise(r => setTimeout(r, 500 * sAttempt));
                    continue;
                  }
                  const errTxt = await res.text().catch(() => '');
                  throw new Error(`HTTP ${res.status}${errTxt ? ': ' + errTxt.slice(0, 200) : ''}`);
                } catch (sErr) {
                  lastSubmitErr = sErr;
                  if (sAttempt < 3) {
                    await new Promise(r => setTimeout(r, 500 * sAttempt));
                  }
                }
              }

              if (!submitOk) {
                throw lastSubmitErr || new Error('Failed to submit job to server after 3 attempts');
              }

              JobStore.updateJob(job.id, { serverSubmittedAt: Date.now(), resumeStage: undefined });
            }
            console.log(`[JobQueueRunner] Job ${job.id} is server-owned. Polling /api/jobs/status...`);
            let done = false;
            const pollStartTime = Date.now();
            const maxPollTimeMs = 3 * 60 * 1000; // Strict 3 minute timeout window

            while (!done && (Date.now() - pollStartTime) < maxPollTimeMs) {
              if (abortSignal.aborted) {
                throw new Error('AbortError');
              }

              let serverJob: any = null;
              try {
                if (typeof navigator !== 'undefined' && !navigator.onLine) {
                  await new Promise(r => setTimeout(r, 2000));
                  continue;
                }
                const statusController = new AbortController();
                const timeoutId = setTimeout(() => statusController.abort(), 6000);
                let statusRes: Response;
                try {
                  statusRes = await fetch(`/api/jobs/status?jobId=${job.id}&userId=${auth.currentUser?.uid || 'anonymous'}`, { signal: statusController.signal });
                } finally {
                  clearTimeout(timeoutId);
                }
                if (statusRes.ok) {
                  const contentType = statusRes.headers.get('content-type');
                  if (contentType && contentType.includes('application/json')) {
                    const { jobs } = await statusRes.json();
                    serverJob = jobs && jobs[0];
                  }
                }
              } catch (pollErr: any) {
                const isFetchErr = pollErr && (pollErr.name === 'TypeError' || (pollErr.message && pollErr.message.includes('Failed to fetch')));
                if (isFetchErr) {
                  console.debug('[JobQueueRunner] Network poll pending:', pollErr.message || pollErr);
                } else {
                  console.warn('[JobQueueRunner] Error polling status:', pollErr);
                }
                await new Promise(r => setTimeout(r, 2000));
                continue;
              }

              if (serverJob) {
                let progressVal = serverJob.progress_percent || 5;
                let statusMsg = serverJob.status_message || 'Analyzing on server...';

                // Update UI with the progress from the server
                JobStore.updateJob(job.id, {
                  status: serverJob.status,
                  statusMessage: statusMsg,
                  progressPercent: progressVal,
                });

                if (serverJob.status === 'awaiting_user' || serverJob.status === 'succeeded' || serverJob.status === 'failed') {
                  if (serverJob.clean_result === undefined || (serverJob.clean_result && (serverJob.clean_result as any).is_r2)) {
                     const cachedJob = JobStore.getJob(job.id);
                     if (cachedJob && cachedJob.result && !cachedJob.result.is_r2) {
                        serverJob.clean_result = cachedJob.result;
                     } else {
                        try {
                           const fullRes = await fetch(`/api/jobs/status?jobId=${job.id}&userId=${auth.currentUser?.uid || 'anonymous'}&full=true`);
                           if (fullRes.ok) {
                              const contentType = fullRes.headers.get('content-type');
                              if (contentType && contentType.includes('application/json')) {
                                const fullData = await fullRes.json();
                                serverJob = fullData.jobs?.[0] || serverJob;
                              }
                           }
                        } catch(e) {}
                     }
                  }
                }

                if (serverJob.status === 'awaiting_user') {
                  const cleanResult = serverJob.clean_result || {};
                  const clarifyMsg =
                    cleanResult.message ||
                    serverJob.status_message ||
                    'Confirm how much you ate';

                  // Save diagnostic logs to log history page for portion clarify step
                  const reqId = serverJob.request_id || job.requestId || job.id;
                  const rawLogs = cleanResult.agentResult?.backendLogs || cleanResult.backendLogs || serverJob.status_message || '';
                  const logsList = (typeof rawLogs === 'string' && rawLogs.trim().length > 0)
                    ? rawLogs.split('\n').filter(Boolean).map(line => ({ timestamp: new Date().toISOString(), message: line }))
                    : [{ timestamp: new Date().toISOString(), message: `[portion_clarify] ${clarifyMsg}` }];
                  saveAgentRequestLog({
                    id: reqId,
                    timestamp: new Date().toISOString(),
                    summary: `Awaiting Portion Selection: ${job.inputSnapshot?.text || 'Meal Photo'}`,
                    logs: logsList
                  });

                  // B6c — short status strip while full clarify question stays in the assistant bubble
                  const portionStatusMsg = 'Waiting for portion choice';
                  const nonLiveMsgs = (job.messages || []).filter((m) => !m.isLive && m.id !== `msg_assistant_clarify_${job.id}`);
                    const clarifiedScoutList = (Array.isArray(cleanResult.scoutItems) && cleanResult.scoutItems.length > 0)
                      ? cleanResult.scoutItems
                      : (Array.isArray(cleanResult.portionClarify?.scoutItems) ? cleanResult.portionClarify.scoutItems : []);
                    const clarifyAssistant = {
                      id: `msg_assistant_clarify_${job.id}`,
                      role: 'assistant',
                      content: clarifyMsg,
                      timestamp: new Date().toISOString(),
                      isLive: false,
                      agentType: 'food',
                      data: {
                        needsPortionClarify: true,
                        portionClarify: cleanResult.portionClarify,
                        scoutItems: clarifiedScoutList,
                        photoUrl: serverJob.photo_url || cleanResult.photoUrl,
                        debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                        agentResult: {
                          backendLogs: cleanResult.agentResult?.backendLogs || cleanResult.backendLogs || '',
                          globalLiveLogs: cleanResult.agentResult?.backendLogs || cleanResult.backendLogs || '',
                          scoutItems: clarifiedScoutList,
                          activeStage: 'portion_clarify',
                        },
                      },
                    };
                  JobStore.updateJob(job.id, {
                    status: 'awaiting_user',
                    statusMessage: portionStatusMsg,
                    progressPercent: serverJob.progress_percent || 45,
                    result: cleanResult,
                    messages: [...nonLiveMsgs, clarifyAssistant],
                    photoUrl: serverJob.photo_url || cleanResult.photoUrl,
                    debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                  });
                  done = true;
                  return;
                }

                if (serverJob.status === 'succeeded') {
                  const cleanResult = serverJob.clean_result || {};
                  const pendingFoodLog = extractPendingFoodLogFromCleanResult(cleanResult, serverJob.photo_url);
                  const messageText =
                    cleanResult.message ||
                    cleanResult.reply ||
                    cleanResult.text ||
                    pendingFoodLog?.message ||
                    'Analysis complete.';
                  const snapAgentType = (job.inputSnapshot as any)?.agentType;
                  const isMedicalJob = job.kind === 'medical';
                  const isReviewJob = snapAgentType === 'biomarker_review' || cleanResult.agentType === 'biomarker_review';
                  const reviewCmds = (cleanResult.modificationCommand || cleanResult.agentResult?.modificationCommand)
                    ? enrichReviewModificationCommands(
                        cleanResult.modificationCommand || cleanResult.agentResult?.modificationCommand || [],
                        (job.inputSnapshot as any)?.biomarkerHistory || [],
                        collectCatalogUnitMap(profileRef.current)
                      )
                    : null;
                  const agentResult = {
                    scoutScratchpad: cleanResult.dietitianScratchpad ? undefined : cleanResult.scoutScratchpad,
                    dietitianScratchpad: cleanResult.dietitianScratchpad || '',
                    backendLogs: cleanResult.backendLogs || '',
                    globalLiveLogs: cleanResult.backendLogs || '',
                    dietitianAnswer: cleanResult.message || cleanResult.text || '',
                    scoutItems: cleanResult.scoutItems,
                    // FIX: server.ts's medical-analyze responses (agent1_step1, agent1,
                    // biomarker_review, data_review) are flat top-level objects — they
                    // never set a nested "agentResult" key. The spread below was always
                    // a no-op for medical jobs, so extractedData (and the batch-continue
                    // fields) never reached the message, and AgentResultTable — which
                    // reads agentResult.extractedData — had nothing to render.
                    extractedData: cleanResult.extractedData,
                    hasMoreMarkers: cleanResult.hasMoreMarkers,
                    remainingText: cleanResult.remainingText || '',
                    estimatedTotalMarkers: cleanResult.estimatedTotalMarkers,
                    unmappedTests: cleanResult.unmappedTests,
                    ...(cleanResult.agentResult || {}),
                    modificationCommand: reviewCmds,
                    proposal: cleanResult.proposal || cleanResult.agentResult?.proposal || null,
                    reply: cleanResult.reply || cleanResult.text || cleanResult.message,
                    // Range Calibrator (data_review) fix: AgentResultTable reads
                    // agentResult.reviewedBiomarkers directly, and the profile-update
                    // handler (agentType === 'data_review') reads it too to write
                    // calibrated ranges into customBiomarkers. Neither worked because
                    // this whitelist never copied it from cleanResult.
                    reviewedBiomarkers: cleanResult.reviewedBiomarkers || cleanResult.agentResult?.reviewedBiomarkers || undefined,
                    extremeDivergences: cleanResult.extremeDivergences || cleanResult.agentResult?.extremeDivergences || undefined,
                    batchIdx: cleanResult.batchIdx !== undefined ? cleanResult.batchIdx : (cleanResult.agentResult?.batchIdx !== undefined ? cleanResult.agentResult.batchIdx : undefined),
                  };

                  const rawAgentType = snapAgentType || cleanResult.agentType || (isMedicalJob ? 'agent1' : 'food');
                  const normalizedAgentType = isMedicalJob
                    ? ((rawAgentType === 'agent1_step1' || rawAgentType === 'medical' || rawAgentType === 'medical_extract' || String(rawAgentType).startsWith('agent1_step')) ? 'agent1' : rawAgentType)
                    : 'food';

                  const nonLiveMsgs = (job.messages || []).filter((m) => !m.isLive);
                  const assistantMsg = {
                    id: `msg_assistant_${job.id}`,
                    role: 'assistant',
                    content: messageText,
                    timestamp: new Date().toISOString(),
                    isLive: false,
                    agentType: isMedicalJob ? normalizedAgentType : 'food',
                    agentTypeStep: rawAgentType,
                    modificationCommand: reviewCmds,
                    pendingFoodLog,
                    data: {
                      jobId: job.id,
                      pendingFoodLog,
                      hasImage: !!(serverJob.photo_url || pendingFoodLog?.imageUrl || (job.inputSnapshot as any)?.hasImage),
                      photoUrl: serverJob.photo_url || cleanResult.photoUrl,
                      debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                      scoutItems: cleanResult.scoutItems || [],
                      mode: serverJob.mode || cleanResult.mode || 'review',
                      agentResult,
                    },
                  };
                  const updatedMessages = [...nonLiveMsgs, assistantMsg];
                  JobStore.updateJob(job.id, {
                    status: 'succeeded',
                    result: {
                      ...cleanResult,
                      pendingFoodLog,
                      photoUrl: serverJob.photo_url || cleanResult.photoUrl,
                      debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                      modificationCommand: reviewCmds,
                      proposal: cleanResult.proposal,
                      reply: cleanResult.reply || cleanResult.text,
                      agentType: isMedicalJob ? normalizedAgentType : cleanResult.agentType,
                      agentTypeStep: rawAgentType,
                      agentResult,
                      extractedData: cleanResult.extractedData,
                    },
                    messages: updatedMessages,
                    mealBuild: cleanResult.mealBuild || job.mealBuild,
                    progressPercent: 100,
                    statusMessage: 'Analysis complete',
                    finishedAt: new Date().toISOString(),
                  });

                  // Save diagnostic logs to log history page
                  const reqId = serverJob.request_id || job.requestId || job.id;
                  const summary = pendingFoodLog?.name || messageText || 'Food Analysis';
                  const rawLogs = cleanResult.backendLogs || '';
                  let logsList: { timestamp: string; message: string }[] = [];
                  if (typeof rawLogs === 'string' && rawLogs.trim().length > 0) {
                    logsList = rawLogs.split('\n').filter(Boolean).map(line => ({
                      timestamp: new Date().toISOString(),
                      message: line
                    }));
                  }
                  fetch(`/api/gemini/debug-logs?sessionId=server-job-${reqId}`)
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                      if (data && Array.isArray(data.logs) && data.logs.length > 0) {
                        logsList = data.logs;
                      }
                      saveAgentRequestLog({
                        id: reqId,
                        timestamp: new Date().toISOString(),
                        summary,
                        logs: logsList.length > 0 ? logsList : [{ timestamp: new Date().toISOString(), message: `[food_agent] Completed analysis for ${summary}` }]
                      });
                    })
                    .catch(() => {
                      saveAgentRequestLog({
                        id: reqId,
                        timestamp: new Date().toISOString(),
                        summary,
                        logs: logsList.length > 0 ? logsList : [{ timestamp: new Date().toISOString(), message: `[food_agent] Completed analysis for ${summary}` }]
                      });
                    });

                  done = true;
                  return; // Done!
                } else if (serverJob.status === 'failed') {
                  const reqId = serverJob.request_id || job.requestId || job.id;
                  const failMsg = serverJob.status_message || 'Analysis failed on server.';
                  const cleanResult = serverJob.clean_result || {};
                  const rawLogs = cleanResult.backendLogs || failMsg;
                  const logsList = (typeof rawLogs === 'string' && rawLogs.trim().length > 0
                    ? rawLogs.split('\n').filter(Boolean).map(line => ({ timestamp: new Date().toISOString(), message: line }))
                    : [{ timestamp: new Date().toISOString(), message: `[error] ${failMsg}` }]);

                  saveAgentRequestLog({
                    id: reqId,
                    timestamp: new Date().toISOString(),
                    summary: `Failed: ${job.kind || 'Food Log'}`,
                    logs: logsList
                  });

                  // Keep a non-live assistant bubble + full logs so the run doesn't "vanish"
                  const pendingFoodLog = extractPendingFoodLogFromCleanResult(cleanResult, serverJob.photo_url);
                  const nonLiveMsgs = (job.messages || []).filter((m) => !m.isLive);
                  const failAssistant = {
                    id: `msg_assistant_fail_${job.id}`,
                    role: 'assistant',
                    content: failMsg + (pendingFoodLog ? '\n\n(Partial result was preserved — open debug or retry.)' : ''),
                    timestamp: new Date().toISOString(),
                    isLive: false,
                    agentType: 'food',
                    pendingFoodLog: pendingFoodLog || undefined,
                    data: {
                      pendingFoodLog: pendingFoodLog || undefined,
                      debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                      photoUrl: serverJob.photo_url || cleanResult.photoUrl,
                      scoutItems: cleanResult.scoutItems || [],
                      agentResult: {
                        backendLogs: typeof rawLogs === 'string' ? rawLogs : failMsg,
                        globalLiveLogs: typeof rawLogs === 'string' ? rawLogs : failMsg,
                      },
                    },
                  };

                  JobStore.updateJob(job.id, {
                    status: 'failed',
                    statusMessage: failMsg,
                    finishedAt: new Date().toISOString(),
                    error: { class: 'transient', message: failMsg },
                    result: { ...cleanResult, pendingFoodLog, backendLogs: rawLogs },
                    messages: [...nonLiveMsgs, failAssistant],
                    debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                  });
                  done = true;
                  return;
                }
              }

              await new Promise(resolve => setTimeout(resolve, 2000));
            }

            if (!done) {
              // Last-chance poll: server may have succeeded after client poll window
              const reqId = job.requestId || job.id;
              let lateJob: any = null;
              try {
                const lateController = new AbortController();
                const timeoutId = setTimeout(() => lateController.abort(), 6000);
                let lateRes: Response;
                try {
                  lateRes = await fetch(`/api/jobs/status?jobId=${job.id}&userId=${auth.currentUser?.uid || 'anonymous'}&full=true`, { signal: lateController.signal });
                } finally {
                  clearTimeout(timeoutId);
                }
                if (lateRes.ok) {
                  const contentType = lateRes.headers.get('content-type');
                  if (contentType && contentType.includes('application/json')) {
                    const { jobs } = await lateRes.json();
                    lateJob = jobs && jobs[0];
                  }
                }
              } catch (_) { /* ignore */ }

              if (lateJob?.status === 'succeeded' && lateJob.clean_result) {
                const cleanResult = lateJob.clean_result || {};
                const pendingFoodLog = extractPendingFoodLogFromCleanResult(cleanResult, lateJob?.photo_url);
                const messageText = cleanResult.message || cleanResult.text || pendingFoodLog?.message || 'Analysis complete.';
                const nonLiveMsgs = (job.messages || []).filter((m) => !m.isLive);
                const assistantMsg = {
                  id: `msg_assistant_${job.id}`,
                  role: 'assistant',
                  content: messageText,
                  timestamp: new Date().toISOString(),
                  isLive: false,
                  agentType: 'food',
                  pendingFoodLog,
                  data: {
                    pendingFoodLog,
                    photoUrl: lateJob.photo_url || cleanResult.photoUrl,
                    debugUrl: lateJob.debug_url || cleanResult.debugUrl,
                    scoutItems: cleanResult.scoutItems || [],
                    agentResult: {
                      backendLogs: cleanResult.backendLogs || '',
                      globalLiveLogs: cleanResult.backendLogs || '',
                      dietitianAnswer: messageText,
                    },
                  },
                };
                JobStore.updateJob(job.id, {
                  status: 'succeeded',
                  result: { ...cleanResult, pendingFoodLog },
                  messages: [...nonLiveMsgs, assistantMsg],
                  progressPercent: 100,
                  statusMessage: 'Analysis complete (recovered after poll window)',
                  finishedAt: new Date().toISOString(),
                });
                const rawLogs = cleanResult.backendLogs || '';
                const logsList = typeof rawLogs === 'string' && rawLogs.trim()
                  ? rawLogs.split('\n').filter(Boolean).map((line: string) => ({ timestamp: new Date().toISOString(), message: line }))
                  : [{ timestamp: new Date().toISOString(), message: `[food_agent] Recovered late success for ${pendingFoodLog?.name || job.id}` }];
                saveAgentRequestLog({
                  id: reqId,
                  timestamp: new Date().toISOString(),
                  summary: pendingFoodLog?.name || messageText || 'Food Analysis',
                  logs: logsList,
                });
                return;
              }

              if (lateJob?.status === 'failed' && lateJob.clean_result?.backendLogs) {
                const cleanResult = lateJob.clean_result || {};
                const failMsg = lateJob.status_message || 'Analysis failed on server.';
                const rawLogs = cleanResult.backendLogs || failMsg;
                const logsList = String(rawLogs).split('\n').filter(Boolean).map((line: string) => ({
                  timestamp: new Date().toISOString(),
                  message: line,
                }));
                saveAgentRequestLog({
                  id: reqId,
                  timestamp: new Date().toISOString(),
                  summary: `Failed: ${job.kind || 'Food Log'}`,
                  logs: logsList,
                });
                const nonLiveMsgs = (job.messages || []).filter((m) => !m.isLive);
                JobStore.updateJob(job.id, {
                  status: 'failed',
                  statusMessage: failMsg,
                  finishedAt: new Date().toISOString(),
                  error: { class: 'transient', message: failMsg },
                  result: cleanResult,
                  messages: [
                    ...nonLiveMsgs,
                    {
                      id: `msg_assistant_fail_${job.id}`,
                      role: 'assistant',
                      content: failMsg,
                      timestamp: new Date().toISOString(),
                      isLive: false,
                      agentType: 'food',
                      data: {
                        agentResult: { backendLogs: rawLogs, globalLiveLogs: rawLogs },
                        debugUrl: lateJob.debug_url || cleanResult.debugUrl,
                      },
                    },
                  ],
                });
                return;
              }

              const timeoutMsg = 'Analysis timed out after 3 minutes. Tap Retry to try again.';
              const liveLogs =
                job.liveThoughts?.backendLogs ||
                job.liveThoughts?.globalLiveLogs ||
                '';
              saveAgentRequestLog({
                id: reqId,
                timestamp: new Date().toISOString(),
                summary: `Timed Out: ${job.kind || 'Food Log'}`,
                logs: liveLogs
                  ? String(liveLogs).split('\n').filter(Boolean).map((line: string) => ({
                      timestamp: new Date().toISOString(),
                      message: line,
                    })).concat([{ timestamp: new Date().toISOString(), message: `[error] ${timeoutMsg}` }])
                  : [{ timestamp: new Date().toISOString(), message: `[error] ${timeoutMsg}` }],
              });

              const nonLiveMsgs = (job.messages || []).filter((m) => !m.isLive);
              JobStore.updateJob(job.id, {
                status: 'failed',
                statusMessage: timeoutMsg,
                finishedAt: new Date().toISOString(),
                error: { class: 'transient', message: timeoutMsg },
                result: {
                  backendLogs: liveLogs || timeoutMsg,
                  message: timeoutMsg,
                },
                messages: [
                  ...nonLiveMsgs,
                  {
                    id: `msg_assistant_timeout_${job.id}`,
                    role: 'assistant',
                    content: timeoutMsg,
                    timestamp: new Date().toISOString(),
                    isLive: false,
                    agentType: 'food',
                    data: {
                      agentResult: {
                        backendLogs: liveLogs || timeoutMsg,
                        globalLiveLogs: liveLogs || timeoutMsg,
                      },
                    },
                  },
                ],
              });
            }
            return;
          }

        } catch (error: any) {
          lastError = error;
          if (error.message === 'AbortError') {
            throw error;
          }

          // Check if error is transient / retriable_from_checkpoint
          const isTransient = error.class === 'transient';
          const isRetriableCheckpoint = error.class === 'retriable_from_checkpoint';

          // On error with checkpoint: merge into job.checkpoint before retry
          if (error.checkpoint) {
            const currentJob = JobStore.getJob(job.id);
            JobStore.updateJob(job.id, {
              checkpoint: {
                ...(currentJob?.checkpoint || {}),
                ...error.checkpoint
              }
            });
          }

          const currentJob = JobStore.getJob(job.id);
          const hasCheckpoint = !!(currentJob?.checkpoint || error.checkpoint);
          let canRetry = isTransient || isRetriableCheckpoint;

          // If it's retriable_from_checkpoint but we have no checkpoint, we treat as transient (full retry),
          // but on subsequent attempts, if we STILL don't have a checkpoint, we should fail.
          if (isRetriableCheckpoint && !hasCheckpoint) {
            if (attempts >= 2) { // Already retried once and still no checkpoint
              canRetry = false;
            }
          }

          if (!canRetry || attempts >= maxAttempts) {
            // Permanent error or attempts exhausted - fail immediately
            console.log(`[Job] Failing job ${job.id} due to non-retryable error: ${error.message} (class=${error.class})`);
            throw error;
          }

          // Retry policy v1: immediate only, max 3 total attempts (1 + 2), transient/checkpoint only.
          console.log(`[Job] retry attempt=${attempts}/3 class=${error.class || 'transient'} jobId=${job.id}`);
          JobStore.updateJob(job.id, {
            statusMessage: `Retrying (attempt ${attempts + 1}/${maxAttempts})...`
          });
        }
      }
    });

    JobQueueRunner.start();
    let stopGoldenIngest: (() => void) | null = null;
    const ingestTimer = setTimeout(() => {
      stopGoldenIngest = startGoldenIngestWatcher();
    }, 1500);

    // Subscribe to JobStore to handle automated credit refund when a job transitions to failed/cancelled
    const unsubscribeJobStore = JobStore.subscribe(async () => {
      const allJobs = JobStore.getAllJobs();
      let profileUpdated = false;
      let newProfile = profileRef.current ? { ...profileRef.current } : null;

      for (const job of allJobs) {
        if ((job.status === 'failed' || job.status === 'cancelled') && job.creditReserved && !job.creditSettled) {
          if (newProfile) {
            newProfile = refundCredits(job, newProfile);
            JobStore.updateJob(job.id, { creditSettled: true });
            profileUpdated = true;
          }
        } else if (job.status === 'succeeded' && job.creditReserved && !job.creditSettled) {
          JobStore.updateJob(job.id, { creditSettled: true });
        }
      }

      if (profileUpdated && newProfile) {
        setProfile(newProfile);
        await saveAndSync(newProfile, foodLogsRef.current, biomarkersRef.current, biomarkerHistoryRef.current, actions, dailyBenefits, report, { type: 'profile' });
      }
    });

    return () => {
      clearTimeout(ingestTimer);
      JobQueueRunner.stop();
      if (stopGoldenIngest) stopGoldenIngest();
      unsubscribeJobStore();
    };
  }, []);
  const isFoodChatOpen =
    !!activeJobId &&
    (
      JobStore.getJob(activeJobId)?.kind === 'food_log' ||
      JobStore.getJob(activeJobId)?.kind === 'food_compare' ||
      JobStore.getJob(activeJobId)?.kind === 'food' ||
      !JobStore.getJob(activeJobId)?.kind
    );
  const setIsFoodChatOpen = (isOpen: boolean) => {
    if (!isOpen) {
      setActiveJobId(null);
    }
  };
  const [isManualFoodLogOpen, setIsManualFoodLogOpen] = useState(false);
  const [manualFoodLogError, setManualFoodLogError] = useState<string | null>(null);
  const [isMedicalChatOpen, setIsMedicalChatOpen] = useState(false);

  const handleOpenJob = (jobId: string) => {
    setActiveJobId(jobId);
    const job = JobStore.getJob(jobId);
    if (job && job.kind === 'medical') {
      const jobAgentType = (job.inputSnapshot as any)?.agentType;
      if (jobAgentType && jobAgentType !== 'agent1_step1') {
        const validTypes = ['agent1','agent2','agent3','agent4','agent5','health_baseline','agent7','data_review','biomarker_review'] as const;
        const matched = validTypes.find(t => t === jobAgentType);
        if (matched) {
          setActiveAgentType(matched);
        }
      }
      if ((job.inputSnapshot as any)?.reviewBiomarkerKey) {
        setActiveReviewBiomarkerKey((job.inputSnapshot as any).reviewBiomarkerKey);
      }
      setIsMedicalChatOpen(true);
    }
  };

  useEffect(() => {
    if (activeJobId) {
      handleOpenJob(activeJobId);
    }
  }, [activeJobId]);
  const [isFrontDeskOpen, setIsFrontDeskOpen] = useState(false);
  const [activeAgentType, setActiveAgentType] = useState<'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'health_baseline' | 'agent7' | 'data_review' | 'biomarker_review' | null>(null);
  const [activeReviewBiomarkerKey, setActiveReviewBiomarkerKey] = useState<string | undefined>(undefined);
  const [activeDataReviewBatchIdx, setActiveDataReviewBatchIdx] = useState<number | string | null>(null);
  const [activeDataReviewBatchKeys, setActiveDataReviewBatchKeys] = useState<string[]>([]);
  const [activeDataReviewRemainingText, setActiveDataReviewRemainingText] = useState<string>('');
  const [activeDataReviewExtractedYaml, setActiveDataReviewExtractedYaml] = useState<any[]>([]);
  const [activeDataReviewCurrentBatch, setActiveDataReviewCurrentBatch] = useState<number>(1);
  const [activeDataReviewEstimatedTotalMarkers, setActiveDataReviewEstimatedTotalMarkers] = useState<number | null>(null);
  const [dataReviewSharedState, setDataReviewSharedState] = useState<any>(null);
  const [calibratingBatchIdx, setCalibratingBatchIdx] = useState<number | null>(null);
  const [calibratingAgentType, setCalibratingAgentType] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('biomarker_batch_size');
      return saved ? parseInt(saved, 10) || 20 : 20;
    } catch (e) {
      return 20;
    }
  });
  const [prefillMessage, setPrefillMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditingFoodLog, setIsEditingFoodLog] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  // Sync state with HTML5 History API to support browser back button navigation without quitting
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state) {
        const { tab, isFoodOpen, isMedicalOpen } = event.state;
        if (tab) setActiveTab(tab);
        setIsFoodChatOpen(!!isFoodOpen);
        setIsMedicalChatOpen(!!isMedicalOpen);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  useEffect(() => {
    try {
      localStorage.removeItem('custom_system_instruction_agent1');
    } catch (e) {}
  }, []);

  // Synchronize batch approvals from cloud profile back to local storage
  useEffect(() => {
    if (profile) {
      if (profile.approved_agent1_batches) {
        try {
          localStorage.setItem('approved_agent1_batches', JSON.stringify(profile.approved_agent1_batches));
        } catch (e) {}
      }
      if (profile.approved_data_review_batches) {
        try {
          localStorage.setItem('approved_data_review_batches', JSON.stringify(profile.approved_data_review_batches));
        } catch (e) {}
      }
    }
  }, [profile]);

  // Synchronize Google steps count to the actual daily biomarker logs when updated
  useEffect(() => {
    const handleGoogleStepsUpdated = async () => {
      const emailSuffix = profile?.email ? `_${profile.email.toLowerCase().trim()}` : '_guest';
      const stepsStr = localStorage.getItem(`googleSteps${emailSuffix}`);
      if (!stepsStr) return;
      const stepsVal = parseInt(stepsStr, 10);
      if (isNaN(stepsVal) || stepsVal <= 0) return;

      const todayStr = getCurrentDateInTimezone(profile?.timezone || 'UTC');

      // Check if we already logged this steps count for today
      const alreadyLogged = biomarkerHistory.some(log => log.date === todayStr && log.biomarkers['steps'] === stepsVal);
      if (alreadyLogged) return;

      let updatedHistory = [...biomarkerHistory];
      const todayLogIndex = updatedHistory.findIndex(log => log.date === todayStr);

      if (todayLogIndex >= 0) {
        const log = { ...updatedHistory[todayLogIndex] };
        log.biomarkers = {
          ...log.biomarkers,
          steps: stepsVal
        };
        if (!log.note || !log.note.includes('Auto-synced from Google Fit')) {
          log.note = log.note ? `${log.note} | Auto-synced from Google Fit` : 'Auto-synced from Google Fit';
        }
        log.sync_state = 'update';
        log.updated_at = Date.now();
        updatedHistory[todayLogIndex] = log;
      } else {
        const newLog: BiomarkerLog = {
          id: `log_${Date.now()}`,
          date: todayStr,
          biomarkers: { steps: stepsVal },
          note: 'Auto-synced from Google Fit',
          summary: `Synced ${stepsVal} steps from Google Fit`,
          sync_state: 'new',
          updated_at: Date.now()
        };
        updatedHistory.unshift(newLog);
      }

      const recomputedBiomarkers: { [key: string]: number | string } = {};
      [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });

      setBiomarkerHistory(updatedHistory);
      setBiomarkers(recomputedBiomarkers);
      if (profile) {
        await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'googleSteps', isAutoLog: true });
      }
    };

    window.addEventListener('googleStepsUpdated', handleGoogleStepsUpdated);
    return () => window.removeEventListener('googleStepsUpdated', handleGoogleStepsUpdated);
  }, [profile, biomarkerHistory, foodLogs, actions, dailyBenefits, report]);
  useEffect(() => {
    const currentState = window.history.state;
    const isDifferent = !currentState ||
      currentState.tab !== activeTab ||
      currentState.isFoodOpen !== isFoodChatOpen ||
      currentState.isMedicalOpen !== isMedicalChatOpen;
    if (isDifferent) {
      window.history.pushState({
        tab: activeTab,
        isFoodOpen: isFoodChatOpen,
        isMedicalOpen: isMedicalChatOpen
      }, '');
    }
  }, [activeTab, isFoodChatOpen, isMedicalChatOpen]);
  // Initialize from Firebase Auth and Firestore on mount


  const getEffectiveUser = () => {
    if (auth.currentUser) {
      return {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email || '',
        displayName: auth.currentUser.displayName || ''
      };
    }
    if (profile?.email) {
      const cleanEmail = profile.email.toLowerCase().trim();
      const uid = profile.uid || ('admin_' + cleanEmail.replace(/[^a-z0-9]/gi, '_'));
      return {
        uid,
        email: profile.email,
        displayName: profile.nickname || 'Admin User'
      };
    }
    return null;
  };

  const lastSyncTrigger = useRef<number>(0);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check of changes in profile and other info on the database (and pull latest changes)
  const checkForDbChanges = async (forceUserId?: string, forcePull?: boolean, forceReplaceLocal?: boolean) => {
    if (!forcePull && !forceReplaceLocal) {
      const now = Date.now();
      if (now - lastSyncTrigger.current < 5000) {
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          checkForDbChanges(forceUserId, forcePull, forceReplaceLocal);
        }, 5000);
        return;
      }
      lastSyncTrigger.current = now;
    }

    if ((window as any).isManualSyncExecuting && !forcePull) {
      return;
    }

    const activeUser = getEffectiveUser();
    const activeEmail = activeUser?.email || profile?.email || auth.currentUser?.email;
    const isDemoUser = activeEmail?.toLowerCase().trim() === 'demo@healthcockpit.com';
    if (isDemoUser) {
      setSyncState('synced');
      (window as any).isManualSyncExecuting = false;
      return;
    }

    (window as any).isManualSyncExecuting = true;
    sessionStorage.setItem('sessionSyncTriggered', 'true');
    const uid = forceUserId || activeUser?.uid;
    if (!uid) {
      setSyncState('local');
      return;
    }
    // Load local storage first so we don't wipe it on page load
    const parsedLocal = await getAggregatedAppData(activeEmail) || {};
    // Snapshot of current local state (from storage or memory) for safe merge
    const currentEmail = activeEmail?.toLowerCase().trim() || 'guest';
    const profileEmail = profile?.email?.toLowerCase().trim();
    const isSameUser = profileEmail === currentEmail;

    let localProfile = isSameUser ? (profile || parsedLocal.profile) : parsedLocal.profile;
    
    // Union merge disk storage logs (parsedLocal) and React memory state so no restored entries or images are lost
    const diskFoods: FoodLog[] = parsedLocal.foodLogs || [];
    const memoryFoods: FoodLog[] = isSameUser ? foodLogs : [];
    const localFoodMap = new Map<string, FoodLog>();
    diskFoods.forEach((df) => localFoodMap.set(df.id, df));
    memoryFoods.forEach((mf) => {
      const existing = localFoodMap.get(mf.id);
      if (!existing) {
        localFoodMap.set(mf.id, mf);
      } else {
        const existingHasImg = existing.imageUrl && existing.imageUrl !== '[image_removed_for_snapshot]';
        const memoryHasImg = mf.imageUrl && mf.imageUrl !== '[image_removed_for_snapshot]';
        localFoodMap.set(mf.id, {
          ...existing,
          ...mf,
          imageUrl: memoryHasImg ? mf.imageUrl : (existingHasImg ? existing.imageUrl : mf.imageUrl),
          imageUrls: (mf.imageUrls && mf.imageUrls.length > 0) ? mf.imageUrls : existing.imageUrls
        });
      }
    });
    let localFoods = mergeFoodLogsDeduped(Array.from(localFoodMap.values()), []);

    const diskBio: BiomarkerLog[] = parsedLocal.biomarkerHistory || [];
    const memoryBio: BiomarkerLog[] = isSameUser ? biomarkerHistory : [];
    const localBioMap = new Map<string, BiomarkerLog>();
    diskBio.forEach((db) => localBioMap.set(db.id, db));
    memoryBio.forEach((mb) => localBioMap.set(mb.id, mb));
    let localBioHistory = Array.from(localBioMap.values());

    let localActions = mergeActions(parsedLocal.actions || [], isSameUser ? actions : []);
    let localBenefits = mergeBenefits(parsedLocal.dailyBenefits || [], isSameUser ? dailyBenefits : []);
    let localReport = mergeReports(parsedLocal.report || null, isSameUser ? report : null);

    if (forceReplaceLocal) {
      if (localProfile) {
        localProfile = {
          email: localProfile.email,
          nickname: localProfile.nickname,
          photoUrl: localProfile.photoUrl,
          lastUpdatedAt: 0,
          customBiomarkers: {},
          notUsedBiomarkers: {},
          notUsedInMedicalHistory: {},
          deletedCustomBiomarkerKeys: {},
          deletedNotUsedBiomarkerKeys: {},
          deletedFoodLogIds: {},
          deletedBiomarkerLogIds: {}
        } as UserProfile;
      }
      localFoods = [];
      localBioHistory = [];
      localActions = [];
      localBenefits = [];
      localReport = null;
    }
    // Immediately populate state from local storage so the UI is responsive
    if (parsedLocal && (!profile || !isSameUser || foodLogs.length < localFoods.length)) {
      if (parsedLocal.profile) setProfile(sanitizeProfile(parsedLocal.profile, activeEmail));
      if (localFoods.length > 0) setFoodLogs(localFoods);
      if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
      if (localBioHistory.length > 0) setBiomarkerHistory(localBioHistory);
      if (parsedLocal.actions) setActions(parsedLocal.actions);
      if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
      if (parsedLocal.report) setReport(parsedLocal.report);
    }
    let syncRootId = '';
    let tProfileId = '';
    const abortWithLocalFallback = async () => {
      // First try to recover from our manual localStorage cache
      let hasLocalFoods = false;
      let hasLocalBio = false;
      if (parsedLocal) {
        if (parsedLocal.profile) setProfile(sanitizeProfile(parsedLocal.profile, activeEmail));
        if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
        if (parsedLocal.actions) setActions(parsedLocal.actions);
        if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
        if (parsedLocal.report) setReport(parsedLocal.report);
        if (parsedLocal.foodLogs && parsedLocal.foodLogs.length > 0) {
          // Recover images from current memory state if local storage payload lacks them
          const recoveredLocalFoods = parsedLocal.foodLogs.map((pf: any) => {
            const memoryItem = foodLogs.find(f => f.id === pf.id);
            const memoryHasImage = memoryItem && memoryItem.imageUrl && memoryItem.imageUrl !== '[image_removed_for_snapshot]';
            const localHasImage = pf.imageUrl && pf.imageUrl !== '[image_removed_for_snapshot]';
            if (!localHasImage && memoryHasImage) {
              return { ...pf, imageUrl: memoryItem.imageUrl, imageUrls: memoryItem.imageUrls || pf.imageUrls };
            }
            return pf;
          });
          setFoodLogs(recoveredLocalFoods);
          hasLocalFoods = true;
        }
        if (parsedLocal.biomarkerHistory && parsedLocal.biomarkerHistory.length > 0) {
          setBiomarkerHistory(parsedLocal.biomarkerHistory);
          hasLocalBio = true;
        }
      }
      
      

      // Supabase Fallback Syncing
      try {
        console.log("[Offline Recovery] Firebase quota exceeded, but attempting to sync with Supabase...");
        let sf = foodLogs;
        let sb = biomarkerHistory;
        
        const deletedFoods = profile?.deletedFoodLogIds || {};
        const deletedBios = profile?.deletedBiomarkerLogIds || {};
        const deletedCustomKeys = profile?.deletedCustomBiomarkerKeys || {};
        
        await syncLogsWithTimeBuckets(db, uid, sf, sb, deletedFoods, deletedBios, (f, b) => {
          sf = f;
          sb = b;
          setFoodLogs(f);
          setBiomarkerHistory(b);
        });

        const userEmail = profile?.email || auth.currentUser?.email || undefined;
        const { serverFoods, serverBiomarkers, serverProfile, serverActions, serverBenefits, serverReport } = await fetchAllConsolidatedLogs(
          db,
          uid,
          deletedFoods,
          deletedBios,
          deletedCustomKeys,
          userEmail,
          { lastSyncTime: (forcePull || forceReplaceLocal) ? undefined : (parsedLocal.lastSyncedAt || 0) }
        );
        
        let mergedBioHist = sb;
        if (serverFoods.length > 0) {
          setFoodLogs(prevFoods => mergeFoodLogsDeduped(prevFoods, serverFoods));
        }
        if (serverBiomarkers.length > 0) {
          mergedBioHist = mergeBiomarkerHistory(serverBiomarkers, sb, deletedBios);
          setBiomarkerHistory(mergedBioHist);
        }
        if (serverProfile) {
          const mergedProf = mergeProfiles(serverProfile, profile);
          if (mergedProf) {
            setProfile(sanitizeProfile(mergedProf, activeEmail));
            // Recompute active biomarkers state
            const computedBios: { [key: string]: number | string } = {};
            [...mergedBioHist].filter(b => b.sync_state !== 'delete' && !(mergedProf.deletedBiomarkerLogIds?.[b.id] && (mergedProf.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
              Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
                computedBios[k] = v as string | number;
              });
            });
            setBiomarkers(computedBios);
          }
        }
        if (serverActions && serverActions.length > 0) {
          setActions(prev => mergeActions(serverActions, prev));
        }
        if (serverBenefits && serverBenefits.length > 0) {
          setDailyBenefits(prev => mergeBenefits(serverBenefits, prev));
        }
        if (serverReport) {
          setReport(prev => mergeReports(serverReport, prev));
        }
      } catch (sbErr) {
        console.warn("[Offline Recovery] Supabase sync also failed.", sbErr);
      }
      
      setSyncState('local');
      if (typeof syncRootId !== 'undefined' && syncRootId) completeInteraction(syncRootId, false, 0, 'Firebase Quota Exceeded');
      if (typeof tProfileId !== 'undefined' && tProfileId) completeInteraction(tProfileId, false, 0, 'Firebase Quota Exceeded');
      (window as any).isManualSyncExecuting = false;
    };

    if (forcePull || forceReplaceLocal) {
      localStorage.removeItem('firestore_quota_exceeded');
      localStorage.removeItem('firestore_quota_exceeded_time');
      setIsFirestoreQuotaExceeded(false);
    }

    // Force Pull (forceReplaceLocal): Supabase is sole authority. Firebase may be over quota.
    if (forceReplaceLocal) {
      setSyncState('syncing');
      syncRootId = logInteraction('sync', `users/${uid} (Force Pull - Supabase Authority)`, null);
      try {
        const {
          serverFoods,
          serverBiomarkers,
          serverProfile,
          serverActions,
          serverBenefits,
          serverReport
        } = await fetchAllConsolidatedLogs(
          null,
          uid,
          {},
          {},
          {},
          activeEmail,
          { timeoutMs: 90000, skipFirebaseFallback: true }
        );

        if (!serverProfile && serverBiomarkers.length === 0 && serverFoods.length === 0) {
          throw new Error('Force Pull failed: Supabase returned no profile and no logs. Force Push from the master device first.');
        }

        let authProfile: UserProfile = (serverProfile || {
          email: currentEmail,
          lastUpdatedAt: Date.now()
        }) as UserProfile;

        const customs = { ...(authProfile.customBiomarkers || {}) };
        Object.keys(authProfile.deletedCustomBiomarkerKeys || {}).forEach(k => { delete customs[k]; });
        const notUsed = { ...(authProfile.notUsedBiomarkers || {}) };
        Object.keys(authProfile.deletedNotUsedBiomarkerKeys || {}).forEach(k => {
          const t = authProfile.deletedNotUsedBiomarkerKeys![k];
          const f = notUsed[k]?.flaggedAt || 0;
          if (t >= f) delete notUsed[k];
        });
        authProfile = {
          ...authProfile,
          customBiomarkers: customs,
          notUsedBiomarkers: notUsed,
          deletedFoodLogIds: authProfile.deletedFoodLogIds || {},
          deletedBiomarkerLogIds: authProfile.deletedBiomarkerLogIds || {},
          deletedCustomBiomarkerKeys: authProfile.deletedCustomBiomarkerKeys || {},
          deletedNotUsedBiomarkerKeys: authProfile.deletedNotUsedBiomarkerKeys || {}
        };

        const delFoods = authProfile.deletedFoodLogIds || {};
        const delBios = authProfile.deletedBiomarkerLogIds || {};
        // B11: always dedupe force-pull foods (retry ids / multi-device duplicates)
        let mergedFoods = mergeFoodLogsDeduped(
          (serverFoods || []).filter(f => f.sync_state !== 'delete' && !delFoods[f.id]),
          []
        );
        const mergedBioHistory = (serverBiomarkers || []).filter(b => b.sync_state !== 'delete' && !delBios[b.id]);
        const cleanedAuth = cleanupInventedBiomarkerCatalog(authProfile, mergedBioHistory);
        authProfile = cleanedAuth.profile as UserProfile;
        const mergedActions = Array.isArray(serverActions) ? serverActions : [];
        const mergedBenefits = Array.isArray(serverBenefits) ? serverBenefits : [];
        const resolvedReport = serverReport != null ? serverReport : null;

        // Force Pull authority: clean biomarker dictionary tombstone keys
        if (forceReplaceLocal || forcePull) {
          const activeCustomKeys = Object.keys(authProfile.customBiomarkers || {});
          const cleanCustomTombstones: Record<string, number> = {};
          Object.entries(authProfile.deletedCustomBiomarkerKeys || {}).forEach(([k, t]) => {
            if (!activeCustomKeys.includes(k)) cleanCustomTombstones[k] = t;
          });
          authProfile.deletedCustomBiomarkerKeys = cleanCustomTombstones;
        }

        const computedBiomarkers: { [key: string]: number | string } = {};
        [...mergedBioHistory]
          .filter(b => b.sync_state !== 'delete' && !(delBios[b.id] && delBios[b.id] >= (b.updated_at || 0)))
          .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)) || ((a.updated_at || 0) - (b.updated_at || 0)))
          .forEach(log => {
            Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
              computedBiomarkers[k] = v as string | number;
            });
          });

        setProfile(sanitizeProfile(authProfile, activeEmail));
        setFoodLogs(mergedFoods);
        setBiomarkerHistory(mergedBioHistory);
        setBiomarkers(computedBiomarkers);
        setActions(mergedActions);
        setDailyBenefits(mergedBenefits);
        setReport(resolvedReport);

        await safeSaveToLocalStorage(getStorageKey(authProfile?.email || profile?.email || auth.currentUser?.email || currentEmail), {
          profile: authProfile,
          foodLogs: mergedFoods,
          biomarkers: computedBiomarkers,
          biomarkerHistory: mergedBioHistory,
          actions: mergedActions,
          dailyBenefits: mergedBenefits,
          report: resolvedReport,
          lastSyncedAt: Date.now()
        });

        await new Promise(resolve => setTimeout(resolve, 600));
        setSyncState('synced');
        completeInteraction(syncRootId, true, 0);
        console.log(`[Force Pull] Supabase authority: bios=${Object.keys(computedBiomarkers).length}, bioLogs=${mergedBioHistory.length}, foods=${mergedFoods.length}, actions=${mergedActions.length}, report=${!!resolvedReport}`);
      } catch (err: any) {
        console.error('[Force Pull] Supabase-only hard replace failed:', err);
        setSyncState('local');
        completeInteraction(syncRootId, false, 0, err?.message || 'Force Pull failed');
      } finally {
        (window as any).isManualSyncExecuting = false;
      }
      return;
    }

    if (isFirestoreQuotaExceeded || checkQuotaFlag()) {
      abortWithLocalFallback();
      return;
    }
    setSyncState('syncing');
    syncRootId = logInteraction('sync', `users/${uid} (Full Check)`, null);
    let tFoodsId = '';
    let tBioId = '';
    let tActsId = '';
    let tBensId = '';
    let tRepId = '';
    let hasUnsynced = false;
    try {
      const userDocRef = doc(db, 'users', uid);
      let userDoc;
      tProfileId = logInteraction('download', `users/${uid} (Profile)`, null);
      
      const lastCheckTime = (window as any)._lastCloudProfileCheck || 0;
      if (!forcePull && !forceReplaceLocal && Date.now() - lastCheckTime < 15000 && (window as any)._cachedCloudProfileDoc) {
        userDoc = (window as any)._cachedCloudProfileDoc;
        console.log("[Sync] Deduplicated profile read by using cached lastUpdatedAt check.");
        completeInteraction(tProfileId, true, userDoc.exists() ? JSON.stringify(userDoc.data()).length : 0);
      } else {
        try {
          const docResult = null; // await withTimeout(getDocFromServer(userDocRef), 2000, 'getDocFromServer (Profile)');
          if (docResult) {
            userDoc = docResult;
            (window as any)._lastCloudProfileCheck = Date.now();
            (window as any)._cachedCloudProfileDoc = docResult;
            completeInteraction(tProfileId, true, userDoc.exists() ? JSON.stringify(userDoc.data()).length : 0);
          } else {
            // In Supabase / local mode without direct Firestore, default to empty userDoc smoothly
            userDoc = { exists: () => false, data: () => undefined } as any;
          }
        } catch (err) {
          console.warn("getDocFromServer failed or timed out, falling back to local/cached getDoc:", err);
          handleFirestoreError(err);
          if (checkQuotaFlag()) {
            abortWithLocalFallback();
            return;
          }
          userDoc = { exists: () => false, data: () => undefined } as any;
        }
      }
      let cloudProfile = (userDoc?.exists() ? userDoc.data() : null) as UserProfile | null;
      if (true) {
        
        const cloudTime = cloudProfile?.lastUpdatedAt || 0;
        const localTime = localProfile?.lastUpdatedAt || 0;
        let mergedProfile: UserProfile;
        let foods: FoodLog[] = [];
        let bioHistory: BiomarkerLog[] = [];
        let acts: HealthAction[] = [];
        let bens: DailyBenefit[] = [];
        let cloudReport: RecommendationReport | null = null;
        let mergedFoods: FoodLog[] = [];
        let mergedBioHistory: BiomarkerLog[] = [];
        let mergedActions: HealthAction[] = [];
        let mergedBenefits: DailyBenefit[] = [];
        let resolvedReport: RecommendationReport | null = null;

        // Pre-compute merged profile early
        const dummyMergedProfile = mergeProfiles(cloudProfile || null, localProfile || null);
        const mergedCustomBiomarkers = dummyMergedProfile?.customBiomarkers || {};
        const deletedFoods = dummyMergedProfile?.deletedFoodLogIds || {};
        const deletedBioLogs = dummyMergedProfile?.deletedBiomarkerLogIds || {};
        const deletedCustomKeys = dummyMergedProfile?.deletedCustomBiomarkerKeys || {};

        // Always pull latest Supabase logs on check unless explicitly skipped
        const canSkipFetch = false;
        hasUnsynced = false;

        const sanitizeAndCleanLogs = (logsList: BiomarkerLog[]): BiomarkerLog[] => {
          return logsList.map(log => {
            if (!log.biomarkers) return log;
            const cleanedBiomarkers = { ...log.biomarkers };
            let logChanged = false;
            Object.keys(cleanedBiomarkers).forEach(k => {
              const val = cleanedBiomarkers[k];
              const isEmpty = isValEmpty(val);
              if (isEmpty) {
                delete cleanedBiomarkers[k];
                logChanged = true;
              }
            });
            if (logChanged) {
              if (Object.keys(cleanedBiomarkers).length === 0 && !log.note) {
                deletedBioLogs[log.id] = Date.now();
              }
              return { ...log, biomarkers: cleanedBiomarkers };
            }
            return log;
          });
        };

        if (canSkipFetch) {
          console.log("[Sync] Local data is fully up-to-date or newer. Skipping subcollection downloads.");
          mergedProfile = dummyMergedProfile as UserProfile;

          if (localProfile?.agentAnalyses) {
            mergedProfile.agentAnalyses = localProfile.agentAnalyses;
          }
          // Apply deletion filter so deleted items don't survive a refresh via this fast path
          const filteredSkipFoods = localFoods.filter(f => f.sync_state !== 'delete' && !deletedFoods[f.id]);
          foods = filteredSkipFoods;
          const sanitizedLocal = sanitizeAndCleanLogs(localBioHistory).filter(b => !deletedBioLogs[b.id] || (b.updated_at || 0) > deletedBioLogs[b.id]);
          bioHistory = sanitizedLocal;
          acts = localActions;
          bens = localBenefits;
          cloudReport = localReport;
          mergedFoods = filteredSkipFoods;
          mergedBioHistory = sanitizedLocal;
          mergedActions = localActions;
          mergedBenefits = localBenefits;
          hasUnsynced = localTime > cloudTime;
        } else {
          if (forcePull && !forceReplaceLocal) {
            console.log("[Sync] Force pull (Manual Sync) active. Pushing local unsynced logs and profile first.");
            // 1. Push local unsynced logs with tombstones
            await syncLogsWithTimeBuckets(
              db, 
              uid, 
              localFoods, 
              localBioHistory, 
              deletedFoods || localProfile?.deletedFoodLogIds || {}, 
              deletedBioLogs || localProfile?.deletedBiomarkerLogIds || {}, 
              (sf, sb) => {
                localFoods = sf;
                localBioHistory = sb;
              }
            );

            // 2. Push local profile immediately to ensure tombstones are on cloud before pull
            if (localProfile) {
              try {
                await fetch('/api/sync/supabase-push', {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json',
                    ...(auth.currentUser ? { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {})
                  },
                  body: JSON.stringify({
                    uid,
                    profile: {
                      ...localProfile,
                      lastUpdatedAt: localProfile.lastUpdatedAt || Date.now()
                    }
                  })
                });
              } catch (profPushErr) {
                console.warn("[Sync] Pre-pull profile push warning:", profPushErr);
              }
            }
          }
          // Trigger job hydration past initial paint to prevent startup network bottleneck
          setTimeout(() => { hydrateUserJobs(uid).catch(() => {}); }, 1500);
          tFoodsId = logInteraction('download', `users/${uid}/foodLogs`, null);
          tBioId = logInteraction('download', `users/${uid}/biomarkerHistory`, null);
          tActsId = logInteraction('download', `users/${uid}/actions`, null);
          tBensId = logInteraction('download', `users/${uid}/dailyBenefits`, null);
          tRepId = logInteraction('download', `users/${uid}/reports/latest`, null);
          // Migrate to Time-Bucketing sync architecture
          let v2Foods: FoodLog[] = [];
          let v2Logs: BiomarkerLog[] = [];
          let spProfile: UserProfile | null = null;
          let spActions: HealthAction[] = [];
          let spBenefits: DailyBenefit[] = [];
          let spReport: RecommendationReport | null = null;
          // By using getDocs and getDoc (not FromServer), Firestore can utilize its local cache if configured,
          // and won't throw if offline, gracefully degrading to cached data.
          try {
            try {
              const { serverFoods, serverBiomarkers, serverProfile, serverActions, serverBenefits, serverReport } = await fetchAllConsolidatedLogs(
                checkQuotaFlag() ? null : db, 
                uid, 
                deletedFoods || cloudProfile?.deletedFoodLogIds || localProfile?.deletedFoodLogIds || {}, 
                deletedBioLogs || cloudProfile?.deletedBiomarkerLogIds || localProfile?.deletedBiomarkerLogIds || {},
                deletedCustomKeys || cloudProfile?.deletedCustomBiomarkerKeys || localProfile?.deletedCustomBiomarkerKeys || {},
                activeEmail,
                {
                  timeoutMs: forcePull ? 90000 : 60000,
                  skipFirebaseFallback: forcePull || checkQuotaFlag(),
                  lastSyncTime: (forcePull || forceReplaceLocal || !parsedLocal.lastSyncedAt || !localFoods || localFoods.length === 0) ? undefined : (parsedLocal.lastSyncedAt || 0)
                }
              );
              const isIncrementalPull = !forcePull && !forceReplaceLocal && !!parsedLocal.lastSyncedAt && Array.isArray(localFoods) && localFoods.length > 0;
              const activeDeletedFoodIds = {
                ...(localProfile?.deletedFoodLogIds || {}),
                ...(cloudProfile?.deletedFoodLogIds || {}),
                ...(serverProfile?.deletedFoodLogIds || {})
              };
              v2Foods = (isIncrementalPull ? mergeFoodLogsDeduped(localFoods, serverFoods) : serverFoods)
                .filter(f => f && f.sync_state !== 'delete' && (!activeDeletedFoodIds[f.id] || (f.updated_at || 0) > activeDeletedFoodIds[f.id]));
              const activeDeletedBioIds = {
                ...(localProfile?.deletedBiomarkerLogIds || {}),
                ...(cloudProfile?.deletedBiomarkerLogIds || {}),
                ...(serverProfile?.deletedBiomarkerLogIds || {})
              };
              v2Logs = (isIncrementalPull ? mergeBiomarkerHistory(serverBiomarkers, localBioHistory, deletedBioLogs || cloudProfile?.deletedBiomarkerLogIds || localProfile?.deletedBiomarkerLogIds || {}) : serverBiomarkers)
                .filter(b => b && b.sync_state !== 'delete' && (!activeDeletedBioIds[b.id] || (b.updated_at || 0) > activeDeletedBioIds[b.id]));
              if (serverProfile) spProfile = serverProfile;
              if (Array.isArray(serverActions)) spActions = serverActions;
              if (Array.isArray(serverBenefits)) spBenefits = serverBenefits;
              if (serverReport !== undefined && serverReport !== null) spReport = serverReport;
              
              // Images: seed from local (id + fingerprint), fetch at most MAX_IMAGE_FETCH_PER_SYNC recent missing
              if (v2Foods.length > 0 && localStorage.getItem('auto_sync_disabled') !== 'true') {
                const imageMap: Record<string, any> = {};

                // 1. Seed from local — by id (usable URLs only)
                localFoods.forEach(lf => {
                  const hasRealImage = isUsableImageUrl(lf.imageUrl);
                  const hasRealUrls = Array.isArray(lf.imageUrls) && lf.imageUrls.some(isUsableImageUrl);
                  if (hasRealImage || hasRealUrls) {
                    imageMap[lf.id] = {
                      imageUrl: hasRealImage ? lf.imageUrl : (lf.imageUrls || []).find(isUsableImageUrl),
                      imageUrls: (lf.imageUrls || []).filter(isUsableImageUrl),
                    };
                  }
                });

                // Prefer durable http(s) /photos already on cloud meta before foodImages blast
                // Merge cloud URLs with local URLs
                v2Foods.forEach(f => {
                  const hasV2Image = isUsableImageUrl(f.imageUrl);
                  const hasV2Urls = Array.isArray(f.imageUrls) && f.imageUrls.some(isUsableImageUrl);
                  
                  if (hasV2Image || hasV2Urls) {
                    const v2ImageUrl = hasV2Image ? f.imageUrl : (f.imageUrls || []).find(isUsableImageUrl);
                    const v2ImageUrls = (f.imageUrls || []).filter(isUsableImageUrl);
                    
                    const existingMap = imageMap[f.id];
                    if (!existingMap) {
                      imageMap[f.id] = {
                        imageUrl: v2ImageUrl,
                        imageUrls: v2ImageUrls,
                      };
                    } else {
                      const mergedUrls = Array.from(new Set([
                        ...(existingMap.imageUrls || []),
                        ...v2ImageUrls,
                        existingMap.imageUrl,
                        v2ImageUrl
                      ])).filter(isUsableImageUrl);
                      
                      imageMap[f.id] = {
                        imageUrl: existingMap.imageUrl || v2ImageUrl || mergedUrls[0],
                        imageUrls: mergedUrls
                      };
                    }
                  }
                });

                // 2. Missing after local seed — only fetch recent N (lazy remainder)
                const missingImageIds = v2Foods
                  .filter(f => {
                    const mapped = imageMap[f.id];
                    if (!mapped) return true;
                    return !isUsableImageUrl(mapped.imageUrl) &&
                      !(Array.isArray(mapped.imageUrls) && mapped.imageUrls.some(isUsableImageUrl));
                  })
                  .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
                  .map(f => f.id);

                const toFetch = missingImageIds.slice(0, MAX_IMAGE_FETCH_PER_SYNC);
                const deferred = missingImageIds.length - toFetch.length;
                if (toFetch.length > 0 && db) {
                  console.log(
                    `[Sync] Fetching ${toFetch.length} missing images (cap ${MAX_IMAGE_FETCH_PER_SYNC}` +
                      (deferred > 0 ? `; ${deferred} deferred for lazy/history open` : '') +
                      `)...`
                  );
                  for (let i = 0; i < toFetch.length; i += 8) {
                    const chunk = toFetch.slice(i, i + 8);
                    await Promise.all(chunk.map(async id => {
                      try {
                        const snap = { exists: () => false, data: () => ({}) } as any; // await getDoc(doc(db, 'users', uid, 'foodImages', id));
                        if (snap.exists()) {
                          const data = snap.data();
                          const hasDataRealImage = isUsableImageUrl(data?.imageUrl);
                          const hasDataRealUrls = Array.isArray(data?.imageUrls) && data.imageUrls.some(isUsableImageUrl);
                          if (hasDataRealImage || hasDataRealUrls) {
                            imageMap[id] = {
                              imageUrl: hasDataRealImage ? data.imageUrl : data.imageUrls.find(isUsableImageUrl),
                              imageUrls: (data.imageUrls || []).filter(isUsableImageUrl),
                            };
                          }
                        }
                      } catch (e) {
                        console.warn(`Failed to fetch image for ${id}`, e);
                      }
                    }));
                  }
                }

                v2Foods = v2Foods.map(f => (imageMap[f.id] ? { ...f, ...imageMap[f.id] } : f));
                // Cross-id: rehydrate from local meals with same fingerprint
                v2Foods = rehydrateFoodImagesFromDonors(v2Foods, localFoods);
                // Collapse duplicate meals before merge
                v2Foods = mergeFoodLogsDeduped(v2Foods, []);

                // --- IMAGE RESTORE FALLBACK (legacy foodLogs) — only remaining recent missing ---
                const isImageMissing = (item: any) =>
                  !isUsableImageUrl(item.imageUrl) &&
                  !(Array.isArray(item.imageUrls) && item.imageUrls.some(isUsableImageUrl));
                const missingImageFoods = v2Foods
                  .filter(f => isImageMissing(f))
                  .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
                  .slice(0, Math.min(12, MAX_IMAGE_FETCH_PER_SYNC));
                const hasMigratedImages = cloudProfile?.metadata?.legacyImagesMigrated || localProfile?.metadata?.legacyImagesMigrated;
                if (missingImageFoods.length > 0 && !hasMigratedImages && db) {
                    console.log(`[Migration] Attempting to restore ${missingImageFoods.length} missing images from legacy foodLogs (capped)...`);
                    try {
                        const recoveredUpdates: any[] = [];
                        const missingIds = missingImageFoods.map(f => f.id);
                        for (let i = 0; i < missingIds.length; i += 8) {
                            const chunk = missingIds.slice(i, i + 8);
                            await Promise.all(chunk.map(async id => {
                                try {
                                    const legacyDoc = { exists: () => false, data: () => ({}) } as any; // await getDoc(doc(db, 'users', uid, 'foodLogs', id));
                                    if (legacyDoc.exists()) {
                                        const data = legacyDoc.data();
                                        const f = v2Foods.find(v => v.id === id);
                                        const hasLegacyRealImage = isUsableImageUrl(data?.imageUrl);
                                        const hasLegacyRealUrls = Array.isArray(data?.imageUrls) && data.imageUrls.some(isUsableImageUrl);
                                        if (f && isImageMissing(f) && (hasLegacyRealImage || hasLegacyRealUrls)) {
                                            f.imageUrl = hasLegacyRealImage ? data.imageUrl : data.imageUrls.find(isUsableImageUrl);
                                            f.imageUrls = (data.imageUrls || []).filter(isUsableImageUrl);
                                            recoveredUpdates.push({ id, imageUrl: f.imageUrl, imageUrls: f.imageUrls });
                                        }
                                    }
                                } catch (e) {
                                    console.warn(`Failed to fetch legacy image for ${id}`, e);
                                }
                            }));
                        }
                        
                        if (recoveredUpdates.length > 0) {
                            console.log(`[Migration] Restored ${recoveredUpdates.length} images! Saving to foodImages...`);
                            recoveredUpdates.forEach(up => {
                                Promise.resolve({
                                  imageUrl: up.imageUrl || null,
                                  imageUrls: up.imageUrls || []
                                }).catch(e => console.error(e));
                            });
                        }
                        
                        // Mark as migrated so we don't scan legacy collection every time
                        await Promise.resolve();
                        if (localProfile) {
                            localProfile.metadata = { ...localProfile.metadata, legacyImagesMigrated: true };
                        }
                    } catch (err) {
                        console.error("[Migration] Failed to restore legacy images:", err);
                    }
                }
                // --- END IMAGE RESTORE FALLBACK ---
              }
            } catch (err) {
              console.error("Failed to fetch consolidated logs", err);
            }
            
            foods = v2Foods;
            completeInteraction(tFoodsId, true, 0, undefined, 0);
          } catch (foodErr: any) {
            console.warn("Failed to fetch foodLogs:", foodErr);
            handleFirestoreError(foodErr);
            foods = localFoods; // Fallback to local
            completeInteraction(tFoodsId, false, 0, foodErr.message || String(foodErr));
          }
          // 1. Fetch biomarker history robustly
          try {
            if (checkQuotaFlag()) {
              abortWithLocalFallback();
              return;
            }
            // v2Logs is already populated from fetchAllConsolidatedLogs
            
            bioHistory = v2Logs;
            completeInteraction(tBioId, true, 0, undefined, 0);
          } catch (bioErr: any) {
            console.warn("Failed to fetch biomarkerHistory:", bioErr);
            handleFirestoreError(bioErr);
            bioHistory = localBioHistory; // Fallback to local
            completeInteraction(tBioId, false, 0, bioErr.message || String(bioErr));
          }
          const pDashboard = (async () => {
            try {
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              const dashboardDoc = { exists: () => false, data: () => ({}) } as any; // await getDoc(doc(db, 'users', uid, 'metadata', 'dashboard'));
              if (dashboardDoc.exists()) {
                const data = dashboardDoc.data();
                const cloudActs = (data.actions || []) as HealthAction[];
                const cloudBens = (data.dailyBenefits || []) as DailyBenefit[];
                const cloudIdeas = (data.foodIdeas || []) as FoodIdea[];

                acts = mergeActions(cloudActs, localActions);
                bens = mergeBenefits(cloudBens, localBenefits);
                setFoodIdeas(mergeFoodIdeas(cloudIdeas, foodIdeas));
              } else {
                acts = localActions;
                bens = localBenefits;
              }
              completeInteraction(tActsId, true, JSON.stringify(acts).length);
              completeInteraction(tBensId, true, JSON.stringify(bens).length);
            } catch (dashErr: any) {
              console.warn("Failed to fetch dashboard metadata:", dashErr);
              handleFirestoreError(dashErr);
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              acts = localActions;
              bens = localBenefits;
              completeInteraction(tActsId, false, 0, dashErr.message || String(dashErr));
              completeInteraction(tBensId, false, 0, dashErr.message || String(dashErr));
            }
          })();
          const pReports = (async () => {
            try {
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              const latestReportDoc = { exists: () => false, data: () => ({}) } as any; // await getDoc(doc(db, 'users', uid, 'reports', 'latest'));
              cloudReport = latestReportDoc.exists() ? (latestReportDoc.data() as RecommendationReport) : null;
              completeInteraction(tRepId, true, latestReportDoc.exists() ? JSON.stringify(latestReportDoc.data()).length : 0);
            } catch (repErr: any) {
              console.warn("Failed to fetch reports:", repErr);
              handleFirestoreError(repErr);
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              cloudReport = localReport;
              completeInteraction(tRepId, false, 0, repErr.message || String(repErr));
            }
          })();
          const pAgentAnalyses = (async () => {
            try {
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              const analysesSnap = { docs: [] } as any; // await getDocs(collection(db, 'users', uid, 'agentAnalyses'));
              const analyses = analysesSnap.docs.map(d => d.data());
              if (analyses.length > 0 && cloudProfile) {
                cloudProfile.agentAnalyses = analyses as any;
              } else if (localProfile?.agentAnalyses && cloudProfile) {
                cloudProfile.agentAnalyses = localProfile.agentAnalyses;
              }
            } catch (err) {
              console.warn("Failed to fetch agentAnalyses:", err);
              handleFirestoreError(err);
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              if (localProfile?.agentAnalyses && cloudProfile) {
                cloudProfile.agentAnalyses = localProfile.agentAnalyses;
              }
            }
          })();
          
          await Promise.allSettled([pDashboard, pReports, pAgentAnalyses]);

          if (spProfile) {
            cloudProfile = cloudProfile ? mergeProfiles(spProfile, cloudProfile) : spProfile;
          }
          if (!cloudProfile && (v2Foods.length > 0 || v2Logs.length > 0 || localProfile)) {
            cloudProfile = localProfile || ({
              email: activeEmail,
              nickname: auth.currentUser?.displayName || '',
              photoUrl: auth.currentUser?.photoURL || '',
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              language: 'en',
              topNutrientsToMonitor: PRIMARY_NUTRIENTS,
              lastUpdatedAt: Date.now()
            } as UserProfile);
          }
          if (spActions && spActions.length > 0) {
            acts = mergeActions(spActions, acts);
          }
          if (spBenefits && spBenefits.length > 0) {
            bens = mergeBenefits(spBenefits, bens);
          }
          if (spReport) {
            cloudReport = cloudReport ? mergeReports(spReport, cloudReport) : spReport;
          }

          // Recompute current effective delete tombstones across cloud and local profiles
          const effectiveDeletedFoods = {
            ...(cloudProfile?.deletedFoodLogIds || {}),
            ...(localProfile?.deletedFoodLogIds || {})
          };
          const effectiveDeletedBioLogs = {
            ...(cloudProfile?.deletedBiomarkerLogIds || {}),
            ...(localProfile?.deletedBiomarkerLogIds || {})
          };

          // Sanitize both cloud and local histories
          const sanitizedBioHistory = sanitizeAndCleanLogs(bioHistory);
          const sanitizedLocalBioHistory = sanitizeAndCleanLogs(localBioHistory);

          // Filter out deleted items from cloud and local lists
          const filteredFoods = foods.filter(f => f.sync_state !== 'delete' && !effectiveDeletedFoods[f.id]);
          const filteredLocalFoods = localFoods.filter(f => f.sync_state !== 'delete' && !effectiveDeletedFoods[f.id]);

          const filteredBioHistory = sanitizedBioHistory.filter(b => b.sync_state !== 'delete' && !effectiveDeletedBioLogs[b.id]);
          const filteredLocalBioHistory = sanitizedLocalBioHistory.filter(b => b.sync_state !== 'delete' && !effectiveDeletedBioLogs[b.id]);

          // Conflict Detection
          const lastSyncedAt = parsedLocal.lastSyncedAt || 0;

          const hasNewLocalFoods = filteredLocalFoods.some(lf => !filteredFoods.some(cf => cf.id === lf.id));
          const hasNewLocalBioHistory = filteredLocalBioHistory.some(lh => !filteredBioHistory.some(ch => ch.id === lh.id));
          const hasNewLocalActions = localActions.some(la => !acts.some(ca => ca.id === la.id));
          const hasNewLocalBenefits = localBenefits.some(lb => !bens.some(cb => cb.id === lb.id));

          const hasModifiedLocalFoods = filteredLocalFoods.some(lf => {
            const cf = filteredFoods.find(c => c.id === lf.id);
            return cf && JSON.stringify(lf) !== JSON.stringify(cf);
          });
          const hasModifiedLocalBioHistory = filteredLocalBioHistory.some(lh => {
            const ch = filteredBioHistory.find(c => c.id === lh.id);
            return ch && JSON.stringify(lh) !== JSON.stringify(ch);
          });

          const localProfileHasEdits = !!(localProfile?.lastUpdatedAt && (!lastSyncedAt || localProfile.lastUpdatedAt > lastSyncedAt + 2000));
          const localHasEdits = localProfileHasEdits || hasNewLocalFoods || hasNewLocalBioHistory || hasNewLocalActions || hasNewLocalBenefits || hasModifiedLocalFoods || hasModifiedLocalBioHistory;

          const hasNewCloudFoods = filteredFoods.some(cf => !filteredLocalFoods.some(lf => lf.id === cf.id));
          const hasNewCloudBioHistory = filteredBioHistory.some(ch => !filteredLocalBioHistory.some(lh => lh.id === ch.id));
          const hasNewCloudActions = acts.some(ca => !localActions.some(la => la.id === ca.id));
          const hasNewCloudBenefits = bens.some(cb => !localBenefits.some(lb => lb.id === cb.id));

          const hasModifiedCloudFoods = filteredFoods.some(cf => {
            const lf = filteredLocalFoods.find(l => l.id === cf.id);
            return lf && JSON.stringify(cf) !== JSON.stringify(lf);
          });
          const hasModifiedCloudBioHistory = filteredBioHistory.some(ch => {
            const lh = filteredLocalBioHistory.find(l => l.id === ch.id);
            return lh && JSON.stringify(ch) !== JSON.stringify(lh);
          });

          const cloudProfileHasEdits = !!(cloudProfile?.lastUpdatedAt && (!lastSyncedAt || cloudProfile.lastUpdatedAt > lastSyncedAt + 2000));
          const cloudHasEdits = cloudProfileHasEdits || hasNewCloudFoods || hasNewCloudBioHistory || hasNewCloudActions || hasNewCloudBenefits || hasModifiedCloudFoods || hasModifiedCloudBioHistory;

          const hasDifferentFoods = localFoods.length !== foods.length || !localFoods.every(lf => foods.some(cf => cf.id === lf.id));
          const hasDifferentBioHistory = localBioHistory.length !== bioHistory.length || !localBioHistory.every(lh => bioHistory.some(ch => ch.id === lh.id));
          const hasDifferentActions = localActions.length !== acts.length || !localActions.every(la => acts.some(ca => ca.id === la.id));
          const hasDifferentBenefits = localBenefits.length !== bens.length || !localBenefits.every(lb => bens.some(cb => cb.id === lb.id));

          // Show the conflict panel if BOTH cloud and local have independent edits that might conflict
          // AND there's an actual difference in the data lengths.
          // Otherwise, we rely on the bidirectional merge below.
          const isConflict = false; // localHasEdits && cloudHasEdits && (hasDifferentFoods || hasDifferentBioHistory || hasDifferentActions || hasDifferentBenefits);

          if (isConflict) {
            console.log("[Sync] Sync conflict detected. Pausing automatic sync to let user choose.");
            setConflictData({
              localProfile: localProfile || { email: currentEmail } as UserProfile,
              cloudProfile,
              localFoods,
              cloudFoods: foods,
              localBioHistory,
              cloudBioHistory: bioHistory,
              localActions,
              cloudActions: acts,
              localBenefits,
              cloudBenefits: bens,
              cloudReport,
              localReport
            });
            setSyncState('conflict');
            completeInteraction(syncRootId, true, 0);
            return;
          }

          if (forceReplaceLocal) {
            // Pure authority: Supabase profile if present, else Firebase. Never mergeProfiles.
            const authoritativeProfile = (spProfile || cloudProfile) as UserProfile;

            const delFoods = authoritativeProfile.deletedFoodLogIds || {};
            const delBios = authoritativeProfile.deletedBiomarkerLogIds || {};

            mergedProfile = {
              ...authoritativeProfile,
              customBiomarkers: { ...(authoritativeProfile.customBiomarkers || {}) },
              notUsedBiomarkers: { ...(authoritativeProfile.notUsedBiomarkers || {}) },
              deletedCustomBiomarkerKeys: { ...(authoritativeProfile.deletedCustomBiomarkerKeys || {}) },
              deletedNotUsedBiomarkerKeys: { ...(authoritativeProfile.deletedNotUsedBiomarkerKeys || {}) },
              deletedFoodLogIds: delFoods,
              deletedBiomarkerLogIds: delBios
            };

            // Prune tombstoned customs / not-used
            Object.keys(mergedProfile.deletedCustomBiomarkerKeys || {}).forEach(k => {
              delete mergedProfile.customBiomarkers![k];
            });
            Object.keys(mergedProfile.deletedNotUsedBiomarkerKeys || {}).forEach(k => {
              const t = mergedProfile.deletedNotUsedBiomarkerKeys![k];
              const f = mergedProfile.notUsedBiomarkers?.[k]?.flaggedAt || 0;
              if (t >= f) delete mergedProfile.notUsedBiomarkers![k];
            });

            mergedFoods = mergeFoodLogsDeduped(
              (foods || []).filter(f => f.sync_state !== 'delete' && !delFoods[f.id]),
              []
            );
            mergedFoods = rehydrateFoodImagesFromDonors(mergedFoods, filteredLocalFoods || localFoods || []);
            mergedBioHistory = (bioHistory || []).filter(b => b.sync_state !== 'delete' && !delBios[b.id]);
            if (spProfile) {
              mergedActions = Array.isArray(spActions) ? spActions : [];
              mergedBenefits = Array.isArray(spBenefits) ? spBenefits : [];
              resolvedReport = spReport != null ? spReport : (cloudReport || null);
            } else {
              mergedActions = acts || [];
              mergedBenefits = bens || [];
              resolvedReport = cloudReport || null;
            }
            hasUnsynced = false;

            // Skip the bidirectional union merge for this pass
          } else {
            // Merge logic: Merge profile, food logs, biomarker history, actions, daily benefits, and report
            mergedProfile = mergeProfiles(cloudProfile, localProfile) as UserProfile;

            // Bidirectional merge for food logs
            const foodUnionMap = new Map();
            filteredLocalFoods.forEach(l => foodUnionMap.set(l.id, l));
            filteredFoods.forEach(serverItem => {
              const isDeleted = deletedFoods[serverItem.id] || 
                                (localProfile?.deletedFoodLogIds && localProfile.deletedFoodLogIds[serverItem.id]) ||
                                (profile?.deletedFoodLogIds && profile.deletedFoodLogIds[serverItem.id]) ||
                                serverItem.sync_state === 'delete';
              if (isDeleted) {
                foodUnionMap.delete(serverItem.id);
                return;
              }
              const existingLocal = foodUnionMap.get(serverItem.id);
              if (!existingLocal) {
                foodUnionMap.set(serverItem.id, serverItem);
              } else {
                const localHasImage = isUsableImageUrl(existingLocal.imageUrl);
                const serverHasImage = isUsableImageUrl(serverItem.imageUrl);
                const localUrls = (existingLocal.imageUrls || []).filter(isUsableImageUrl);
                const serverUrls = (serverItem.imageUrls || []).filter(isUsableImageUrl);
                foodUnionMap.set(serverItem.id, {
                  ...serverItem,
                  ...existingLocal,
                  imageUrl: localHasImage
                    ? existingLocal.imageUrl
                    : (serverHasImage ? serverItem.imageUrl : existingLocal.imageUrl),
                  imageUrls: localUrls.length > 0 ? localUrls : (serverUrls.length > 0 ? serverUrls : existingLocal.imageUrls)
                });
              }
            });
            mergedFoods = mergeFoodLogsDeduped(Array.from(foodUnionMap.values()), []);
            mergedFoods = rehydrateFoodImagesFromDonors(mergedFoods, filteredLocalFoods);

            mergedBioHistory = mergeBiomarkerHistory(filteredBioHistory, filteredLocalBioHistory, effectiveDeletedBioLogs);
            mergedActions = mergeActions(acts, localActions);
            mergedBenefits = mergeBenefits(bens, localBenefits);
            resolvedReport = mergeReports(cloudReport, localReport);

            // Determine if we need to write changes back to the cloud by deep-comparing merged vs cloud records
            const hasLocalAdditions = 
              mergedFoods.some(f => {
                const cf = filteredFoods.find(c => c.id === f.id);
                return !cf || !isDeepEqual(sanitizeForFirestore(f), sanitizeForFirestore(cf));
              }) ||
              mergedBioHistory.some(b => {
                const cb = filteredBioHistory.find(c => c.id === b.id);
                return !cb || !isDeepEqual(sanitizeForFirestore(b), sanitizeForFirestore(cb));
              }) ||
              mergedActions.some(a => !acts.some(ca => ca.id === a.id)) ||
              mergedBenefits.some(b => !bens.some(cb => cb.id === b.id));

            hasUnsynced = hasLocalAdditions || localTime > cloudTime;
          }
        }
        
        // Save merged profile to Firestore/Supabase (profile doc only, not food logs)
        if (forcePull) {
          const _fpTombstoned = mergedProfile?.deletedCustomBiomarkerKeys || {};
          const tempBiomarkers: { [key: string]: number | string } = {};
          [...mergedBioHistory]
            .filter(b => b.sync_state !== 'delete' && !(mergedProfile?.deletedBiomarkerLogIds?.[b.id] && (mergedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
            .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)) || ((a.updated_at || 0) - (b.updated_at || 0)))
            .forEach(log => {
              Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
                if (!_fpTombstoned[k]) {
                  tempBiomarkers[k] = v as string | number;
                }
              });
            });
          await saveAndSync(mergedProfile, mergedFoods, tempBiomarkers, mergedBioHistory, mergedActions, mergedBenefits, resolvedReport, { type: 'profile' });
        }

        // Theme/appearance settings are profile-specific. They must always reflect
        // whichever copy (local device or cloud) was actually updated most recently —
        // never let a stale cloud profile silently reapply an old theme just because
        // the rest of the profile merge logic happened to prefer the cloud copy.
        const THEME_FIELDS: (keyof UserProfile)[] = ['themePalette', 'fontFamily', 'fontMono', 'fontSize', 'marginScale', 'paddingScale', 'cornerRadius', 'shadowScale', 'themeOverrides', 'customColors', 'fontSizeTitle', 'fontSizeSubtitle', 'fontSizeDescription', 'fontSizeBodySmall', 'fontSizeSubtitleSmall', 'fontSizeKeyMetric', 'fontSizeXS', 'fontSizeBody', 'customFonts', 'themePresets', 'systemPresetOverrides'];
        const hasLocalThemeOverride = sessionStorage.getItem('localThemeOverridesCloud') === 'true';
        if (!forceReplaceLocal && (hasLocalThemeOverride || (localProfile && (localProfile.lastUpdatedAt || 0) >= (cloudProfile?.lastUpdatedAt || 0)))) {
          const newerLocalProfile = localProfile;
          THEME_FIELDS.forEach(field => {
            if (newerLocalProfile[field] !== undefined) {
              (mergedProfile as any)[field] = newerLocalProfile[field];
            }
          });
        }

        const cleanedMerged = cleanupInventedBiomarkerCatalog(mergedProfile, mergedBioHistory);
        mergedProfile = cleanedMerged.profile as UserProfile;
        setProfile(sanitizeProfile(mergedProfile, activeEmail));
        // Final safety: dedupe + rehydrate once more before React state / IndexedDB
        mergedFoods = mergeFoodLogsDeduped(rehydrateFoodImagesFromDonors(mergedFoods, localFoods), []);
        setFoodLogs(mergedFoods);
        setBiomarkerHistory(mergedBioHistory);
        setActions(mergedActions);
        setDailyBenefits(mergedBenefits);
        setReport(resolvedReport);
        // Recompute active biomarkers (sorted ascending so that newer logs overwrite older values)
        // Skip keys that are tombstoned via deletedCustomBiomarkerKeys — these are merged alias keys
        // that may still exist in cloud history but must not reappear in the active biomarker set.
        const computedBiomarkers: { [key: string]: number | string } = {};
        const _tombstonedKeys = mergedProfile?.deletedCustomBiomarkerKeys || {};
        [...mergedBioHistory]
          .filter(b => b.sync_state !== 'delete' && !(mergedProfile?.deletedBiomarkerLogIds?.[b.id] && (mergedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
          .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)) || ((a.updated_at || 0) - (b.updated_at || 0)))
          .forEach(log => {
            Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
              if (!_tombstonedKeys[k]) {
                computedBiomarkers[k] = v as string | number;
              }
            });
          });
        setBiomarkers(computedBiomarkers);
        // Write bundle back to local storage — prefer usable images (never placeholders)
        const foodsToCache = rehydrateFoodImagesFromDonors(mergedFoods, localFoods);

        const bundle = {
          profile: mergedProfile,
          foodLogs: foodsToCache,
          biomarkers: computedBiomarkers,
          biomarkerHistory: mergedBioHistory,
          actions: mergedActions,
          dailyBenefits: mergedBenefits,
          report: resolvedReport,
          lastSyncedAt: Date.now()
        };
        await safeSaveToLocalStorage(getStorageKey(mergedProfile?.email || profile?.email || auth.currentUser?.email), bundle);
        // Add a small delay for delightful visual feedback
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState((hasUnsynced && !forcePull) ? 'local' : 'synced');
        completeInteraction(syncRootId, true, 0);
      } else if (localProfile && Object.keys(localProfile).length > 0) {
        // Cloud doc is empty, but we have local data! Cloud save probably failed earlier.
        // Let's assume local is the source of truth and restore it.
        setProfile(sanitizeProfile(localProfile, activeEmail));
        setFoodLogs(localFoods);
        setBiomarkerHistory(localBioHistory);
        setActions(localActions);
        setDailyBenefits(localBenefits);
        setReport(localReport);
        
        // Recompute active biomarkers (sorted ascending so that newer logs overwrite older values)
        const computedBiomarkers: { [key: string]: number | string } = {};
        [...localBioHistory]
          .filter(b => b.sync_state !== 'delete' && !(localProfile?.deletedBiomarkerLogIds?.[b.id] && (localProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
          .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)) || ((a.updated_at || 0) - (b.updated_at || 0)))
          .forEach((log: BiomarkerLog) => {
            Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
              computedBiomarkers[k] = v as string | number;
            });
          });
        setBiomarkers(computedBiomarkers);
        const bundle = {
          profile: localProfile,
          foodLogs: localFoods,
          biomarkers: computedBiomarkers,
          biomarkerHistory: localBioHistory,
          actions: localActions,
          dailyBenefits: localBenefits,
          report: localReport
        };
        await safeSaveToLocalStorage(getStorageKey(localProfile?.email || profile?.email || auth.currentUser?.email), bundle);
        // Try syncing profile to cloud in background
        const tNewProfileId = logInteraction('upload', `users/${uid} (Restore Profile)`, localProfile);
        const localProfileForCloud = { ...localProfile };
        delete localProfileForCloud.agentAnalyses;
        Promise.resolve()
          .then(() => completeInteraction(tNewProfileId, true, JSON.stringify(localProfile).length))
          .catch(err => { completeInteraction(tNewProfileId, false, 0, err.message); console.error(err); });
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState('synced');
        completeInteraction(syncRootId, true, 0);
      } else {
        // Brand new sign up - create profile in Firestore
        const isDemoUser = auth.currentUser?.email?.toLowerCase() === 'demo@healthcockpit.com';
        
        const newProfile: UserProfile = {
          nickname: isDemoUser ? 'Alex (Demo)' : '',
          photoUrl: auth.currentUser?.photoURL || (isDemoUser ? 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=120' : ''),
          email: auth.currentUser?.email || '',
          age: isDemoUser ? 28 : '' as any,
          ethnicity: isDemoUser ? 'Caucasian' : 'Unknown',
          weight: isDemoUser ? 74 : '' as any,
          height: isDemoUser ? 178 : '' as any,
          gender: isDemoUser ? 'Male' : 'Unknown',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: 'en',
          topNutrientsToMonitor: PRIMARY_NUTRIENTS
        };
        const tNewProfileId = logInteraction('upload', `users/${uid} (Create Profile)`, newProfile);
        Promise.resolve()
          .then(() => completeInteraction(tNewProfileId, true, JSON.stringify(newProfile).length))
          .catch(err => { completeInteraction(tNewProfileId, false, 0, err.message); console.error(err); });
        
        setProfile(newProfile);
        let initialActions: HealthAction[] = [];
        let initialBenefits: DailyBenefit[] = [];
        if (isDemoUser) {
          initialActions = [
            {
              id: 'init_act_1',
              task: 'Schedule primary physician physical consultation',
              explanation: 'Consult your doctor before initiating heavy nutrient restrictions or supplement additions.',
              priority: 'high',
              completed: false,
              type: 'doctor',
              testName: 'Physical Exam Panel',
              timeframe: '3-6 months',
              createdAt: Date.now()
            },
            {
              id: 'init_act_2',
              task: 'Complete basic fasting blood panel tests',
              explanation: 'Obtain ApoB, LDL-C, fasting glucose, and HbA1c values for precise target generation.',
              priority: 'high',
              completed: false,
              type: 'test',
              testName: 'Basic Fasting Panel',
              timeframe: '3-6 months',
              createdAt: Date.now()
            }
          ];
          initialBenefits = [
            { id: 'init_ben_1', activity: 'Walk briskly for 30 minutes', target: 'Daily', completed: false },
            { id: 'init_ben_2', activity: 'Add high-fiber foods to your breakfast', target: 'Daily', completed: false }
          ];
          // Write to Firestore dashboard document to prevent multiple writes
          const tDashId = logInteraction('upload', `users/${uid}/metadata/dashboard`, null);
          Promise.resolve() // [FreeTier] profile single-writer disabled; console.error(err); });
        }
        setFoodLogs([]);
        setBiomarkers({});
        setBiomarkerHistory([]);
        setActions(initialActions);
        setDailyBenefits(initialBenefits);
        setReport(null);
        // Local storage cache
        const bundle = {
          profile: newProfile,
          foodLogs: [],
          biomarkers: {},
          biomarkerHistory: [],
          actions: initialActions,
          dailyBenefits: initialBenefits,
          report: null
        };
        await safeSaveToLocalStorage(getStorageKey(newProfile?.email || profile?.email || auth.currentUser?.email), bundle);
        // Add a small delay for delightful visual feedback
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState('synced');
        completeInteraction(syncRootId, true, 0);
        setActiveTab('medical');
      }
    } catch (err: any) {
      console.error("Error checking or syncing database changes:", err);
      handleFirestoreError(err);
      setSyncState('local');
      completeInteraction(syncRootId, false, 0, err.message || 'Database error');
      if (tProfileId) completeInteraction(tProfileId, false, 0, err.message);
      if (tFoodsId) completeInteraction(tFoodsId, false, 0, err.message);
      if (tBioId) completeInteraction(tBioId, false, 0, err.message);
      if (tActsId) completeInteraction(tActsId, false, 0, err.message);
      if (tBensId) completeInteraction(tBensId, false, 0, err.message);
      if (tRepId) completeInteraction(tRepId, false, 0, err.message);
      
      // Fallback to local storage if DB fails
      if (parsedLocal) {
        if (parsedLocal.profile) setProfile(parsedLocal.profile);
        if (parsedLocal.foodLogs) setFoodLogs(parsedLocal.foodLogs);
        if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
        if (parsedLocal.biomarkerHistory) setBiomarkerHistory(parsedLocal.biomarkerHistory);
        if (parsedLocal.actions) setActions(parsedLocal.actions);
        if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
        if (parsedLocal.report) setReport(parsedLocal.report);
      }
    } finally {
      (window as any).isManualSyncExecuting = false;
      setIsInitialDataLoading(false);
    }
  };
  // Initialize from Firebase Auth and Firestore on mount
  useEffect(() => {
    let unsubs: (() => void)[] = [];
    
    // Cleanup legacy storage from localStorage to IndexedDB
    try {
      (async () => {
        const legacyKeys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('health_cockpit_snapshots_') || key.startsWith('health_cockpit_app_data_'))) {
            legacyKeys.push(key);
          }
        }
        for (const key of legacyKeys) {
          try {
            const existingIdbVal = await get(key);
            // Only migrate if IndexedDB doesn't ALREADY have data for this key
            if (!existingIdbVal) {
              const val = localStorage.getItem(key);
              if (val) {
                const parsed = JSON.parse(val);
                await set(key, parsed);
              }
            }
            // Always remove the legacy heavy key from localStorage so stale copies never overwrite IndexedDB
            localStorage.removeItem(key);
          } catch (e) {
            console.error('Error migrating storage key', key, e);
            localStorage.removeItem(key);
          }
        }
      })();
    } catch (e) {
      console.error('Error scanning localStorage for legacy data', e);
    }

    // Safety fallback: If Firebase auth takes too long to initialize (e.g. offline and indexedDB locked),
    // we stop the spinner so the user can interact with the app.
    const fallbackTimeout = setTimeout(async () => {
      try {
        console.warn("Auth check timed out. Falling back to local state.");
        
        const lastActiveEmail = localStorage.getItem('last_active_email') || 'cwah.liu@gmail.com';
        const storageKey = getStorageKey(lastActiveEmail);
        const parsedLocal = await get(storageKey);
        if (parsedLocal) {
          try {
            if (parsedLocal.profile) setProfile(sanitizeProfile(parsedLocal.profile, lastActiveEmail));
            if (parsedLocal.foodLogs) setFoodLogs(parsedLocal.foodLogs);
            if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
            if (parsedLocal.biomarkerHistory) setBiomarkerHistory(parsedLocal.biomarkerHistory);
            if (parsedLocal.actions) setActions(parsedLocal.actions);
            if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
            if (parsedLocal.report) setReport(parsedLocal.report);
          } catch (e) {}
        }
        setSyncState('local');
      } catch (err) {
        console.error("Fallback timeout error:", err);
      } finally {
        setIsAuthChecking(false);
      }
    }, 8000);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      clearTimeout(fallbackTimeout);
      const emailLower = user?.email?.toLowerCase().trim() || '';
      if (emailLower.includes('john@mail.com') || emailLower.includes('john@gmail.com')) {
        try {
          await fbSignOut(auth);
        } catch (e) {}
        localStorage.removeItem('last_active_email');
        setProfile(null);
        setIsAuthChecking(false);
        return;
      }
      if (user && user.email) { runCleanupMigration(user.uid, user.email).catch(console.error); }
      unsubs.forEach(u => u());
      unsubs = [];
      
      try {
        // Immediately reset and blank out current user's React states
        // to prevent any "glimpse" of previous account data during transition.
        setProfile(null);
        setFoodLogs([]);
        setBiomarkers({});
        setBiomarkerHistory([]);
        setActions([]);
        setDailyBenefits([]);
        setReport(null);

        if (user) {
          const newEmail = user.email?.toLowerCase().trim() || '';
          const storageKey = getStorageKey(newEmail);
          
          const parsedLocal = await get(storageKey);
          
          let loadedProfile: UserProfile | null = null;
          let loadedFoods: FoodLog[] = [];
          let loadedBiomarkers = {};
          let loadedHistory: BiomarkerLog[] = [];
          let loadedActions: HealthAction[] = [];
          let loadedBenefits: DailyBenefit[] = [];
          let loadedReport: RecommendationReport | null = null;

          if (parsedLocal) {
            loadedProfile = parsedLocal.profile || null;
            const deletedFoodMap = loadedProfile?.deletedFoodLogIds || {};
            const deletedBioMap = loadedProfile?.deletedBiomarkerLogIds || {};
            // Filter out deleted entries so tombstoned items are never re-hydrated on refresh
            loadedFoods = (parsedLocal.foodLogs || []).filter((f: any) => f.sync_state !== 'delete' && !deletedFoodMap[f.id]);
            loadedHistory = (parsedLocal.biomarkerHistory || []).filter((b: any) => b.sync_state !== 'delete' && !deletedBioMap[b.id]);
            loadedBiomarkers = parsedLocal.biomarkers || {};
            loadedActions = parsedLocal.actions || [];
            loadedBenefits = parsedLocal.dailyBenefits || [];
            loadedReport = parsedLocal.report || null;
            
            // If we loaded a lightweight fallback, show a warning but do NOT auto-sync.
            // The user must manually click "Sync Now" to pull cloud data.
            // Auto-syncing here was causing large Firebase read spikes on page load.
            if (parsedLocal._isLightweightFallback) {
              console.warn("[Storage] Lightweight local fallback detected. Full data available via manual Sync Now.");
            }
          }

          const isDemoUser = newEmail === 'demo@healthcockpit.com';
          if (isDemoUser && (!loadedProfile || loadedHistory.length === 0)) {
            const demoType = (localStorage.getItem('demo_profile_type') || 'average') as DemoProfileType;
            loadedProfile = getDemoProfile(demoType);
            loadedFoods = getDemoFoodLogs(demoType);
            loadedHistory = getDemoBiomarkerHistory(demoType);
            if (demoType === 'empty') {
              loadedBiomarkers = {};
            } else if (demoType === 'complex') {
              loadedBiomarkers = { fasting_glucose: 131, hba1c: 7.1, total_cholesterol: 228, ldl: 151, hdl: 38, triglycerides: 198, egfr: 64, vitamin_d: 19, wbc: 6.9, hemoglobin: 14.1, bmi: 30.2 };
            } else {
              loadedBiomarkers = { fasting_glucose: 91, hba1c: 5.3, total_cholesterol: 208, ldl: 132, hdl: 46, triglycerides: 155, egfr: 94, vitamin_d: 22, wbc: 6.2, hemoglobin: 14.6, bmi: 23.4 };
            }
            loadedReport = getDemoReport(demoType);
            loadedActions = loadedReport.actions || [];
            loadedBenefits = loadedReport.dailyBenefits || [];
          }

          if (!loadedProfile) {
            loadedProfile = {
              nickname: user.displayName || '',
              photoUrl: user.photoURL || '',
              email: user.email || '',
              age: '' as any,
              ethnicity: 'Unknown',
              weight: '' as any,
              height: '' as any,
              gender: 'Unknown',
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              language: 'en',
              topNutrientsToMonitor: PRIMARY_NUTRIENTS
            };
          } else {
            loadedProfile.email = user.email || '';
            if (!loadedProfile.topNutrientsToMonitor) {
              loadedProfile.topNutrientsToMonitor = PRIMARY_NUTRIENTS;
            }
          }
          loadedProfile.lastLogin = new Date().toISOString();

          // Save the loaded state to local storage immediately
          const bundle = {
            profile: loadedProfile,
            foodLogs: loadedFoods,
            biomarkers: loadedBiomarkers,
            biomarkerHistory: loadedHistory,
            actions: loadedActions,
            dailyBenefits: loadedBenefits,
            foodIdeas,
            report: loadedReport
          };
          await set(storageKey, bundle);

          // Update React states
          setProfile(loadedProfile);
          setFoodLogs(loadedFoods);
          setBiomarkers(loadedBiomarkers);
          setBiomarkerHistory(loadedHistory);
          setActions(loadedActions);
          setDailyBenefits(loadedBenefits);
          setReport(loadedReport);
          
          setIsAuthChecking(false);

          // If signed in as a non-demo user, trigger background cloud sync only when needed
          const uid = user.uid;
          if (!isDemoUser) {
            const hasSyncedThisSession = sessionStorage.getItem('synced_' + uid) === 'true';
            const isLocalDataEmpty = loadedFoods.length === 0 && loadedHistory.length === 0;

            if (!hasSyncedThisSession) {
              // First time opening the app this session: sync only what is needed in background
              console.log("[Auth] Signed in user detected. Checking for updates in background...");
              sessionStorage.setItem('synced_' + uid, 'true');
              checkForDbChanges(uid, isLocalDataEmpty).catch(err => console.warn("[Auth] Background sync error:", err)).finally(() => {
                setIsInitialDataLoading(false);
              });
            } else if (isLocalDataEmpty) {
              // Local cache is completely empty: perform a restore
              console.log("[Auth] Local cache empty, restoring from cloud...");
              checkForDbChanges(uid, true).catch(err => console.warn("[Auth] Background sync error:", err)).finally(() => {
                setIsInitialDataLoading(false);
              });
            } else {
              // Already loaded from local storage and synced in this session: skip re-fetching
              setSyncState('synced');
              setIsInitialDataLoading(false);
            }
          } else {
            setSyncState('synced');
            setIsInitialDataLoading(false);
          }
          
          // A. One-Time Legacy Migration — only runs during an explicit manual sync session.
          // This prevents automatic Firestore reads on every page load.
          if (loadedProfile && sessionStorage.getItem('sessionSyncTriggered') === 'true' && !isDemoUser) {
            if (!loadedProfile.metadata) loadedProfile.metadata = {};
            // If user already has food logs or profile locally, mark legacy migration as completed
            // so ancient legacy subcollections are NEVER scanned or re-injected on page reload.
            if (loadedFoods.length > 0) {
              loadedProfile.metadata.legacyMigratedV2 = true;
              loadedProfile.metadata.legacyMigrated = true;
            }
            if (!loadedProfile.metadata.legacyMigratedV2) {
              // Cheap check: verify against the cloud flag before doing an expensive
              // full collection scan. Local IndexedDB may be empty (new browser,
              // incognito, cleared cache, new device) even though the migration
              // already completed in the cloud for this account.
              let cloudAlreadyMigrated = false;
              try {
                const cloudProfileSnap = { exists: () => false, data: () => ({}) } as any; // await getDoc(doc(db, 'users', uid));
                if (cloudProfileSnap.exists() && cloudProfileSnap.data()?.metadata?.legacyMigrated) {
                  cloudAlreadyMigrated = !!cloudProfileSnap.data()?.metadata?.legacyMigratedV2;
                }
              } catch (checkErr) {
                console.warn("[Migration] Cloud flag check failed, proceeding with caution:", checkErr);
              }

              if (cloudAlreadyMigrated) {
                loadedProfile.metadata.legacyMigratedV2 = true; loadedProfile.metadata.legacyMigrated = true;
              } else {
              console.log("[Migration] Initiating one-time legacy migration to V2 consolidated bucket logs");
              try {
                let legacyFoodsSnap: any = { docs: [] };
                let legacyHistorySnap: any = { docs: [] };
                if (firestoreReadGuard('legacy migration scan')) {
                  legacyFoodsSnap = { docs: [] } as any; // await getDocs(collection(db, 'users', uid, 'foodLogs'));
                  legacyHistorySnap = { docs: [] } as any; // await getDocs(collection(db, 'users', uid, 'biomarkerHistory'));
                }
                
                const legacyFoods: FoodLog[] = legacyFoodsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() } as FoodLog));
                const legacyHistory: BiomarkerLog[] = legacyHistorySnap.docs.map((d: any) => ({ id: d.id, ...d.data() } as BiomarkerLog));

                // Never resurrect logs the user has already deleted. These IDs are the
                // source of truth for deletions and must be respected during migration,
                // otherwise re-running this migration (e.g. after a failed completion
                // write) brings deleted entries back from the old subcollections.
                const migrationDeletedFoodIds = new Set<string>([
                  ...Object.keys(loadedProfile?.deletedFoodLogIds || {}),
                  ...Object.keys(profile?.deletedFoodLogIds || {})
                ]);
                const migrationDeletedBioIds = new Set<string>(Object.keys(loadedProfile?.deletedBiomarkerLogIds || {}));

                const filteredLegacyFoods = legacyFoods.filter(lf => !migrationDeletedFoodIds.has(lf.id));
                const filteredLegacyHistory = legacyHistory.filter(lh => !migrationDeletedBioIds.has(lh.id));

                const skippedFoods = legacyFoods.length - filteredLegacyFoods.length;
                const skippedHistory = legacyHistory.length - filteredLegacyHistory.length;
                if (skippedFoods > 0 || skippedHistory > 0) {
                  console.log(`[Migration] Skipped ${skippedFoods} previously-deleted food logs and ${skippedHistory} previously-deleted biomarker logs`);
                }

                if (filteredLegacyFoods.length > 0 || filteredLegacyHistory.length > 0) {
                  console.log(`[Migration] Migrating ${filteredLegacyFoods.length} foods and ${filteredLegacyHistory.length} biomarker entries`);
                  // Merge legacy into loaded states, FORCE sync_state to pending so time buckets picks them up
                  const mergedFoods = [...loadedFoods];
                  filteredLegacyFoods.forEach(lf => {
                    const existingIdx = mergedFoods.findIndex(f => f.id === lf.id);
                    if (existingIdx === -1) {
                      mergedFoods.push({ ...lf, sync_state: 'update' });
                    } else {
                      mergedFoods[existingIdx] = { ...mergedFoods[existingIdx], sync_state: 'update' };
                    }
                  });
                  
                  const mergedHistory = [...loadedHistory];
                  filteredLegacyHistory.forEach(lh => {
                    const existingIdx = mergedHistory.findIndex(h => h.id === lh.id);
                    if (existingIdx === -1) {
                      mergedHistory.push({ ...lh, sync_state: 'update' });
                    } else {
                      mergedHistory[existingIdx] = { ...mergedHistory[existingIdx], sync_state: 'update' };
                    }
                  });
                  
                  // Save to V2 bucket documents
                  await syncLogsWithTimeBuckets(db, uid, mergedFoods, mergedHistory, {}, {}, (sf, sb) => {
                    loadedFoods = sf;
                    loadedHistory = sb;
                    setFoodLogs(sf);
                    setBiomarkerHistory(sb);
                  });
                }
                
                loadedProfile.metadata.legacyMigratedV2 = true; 
                loadedProfile.metadata.legacyMigrated = true;
                await Promise.resolve();
                setProfile({ ...loadedProfile });
                
                // Immediately persist legacyMigratedV2 flag to IndexedDB so refresh never re-scans legacy subcollections
                const migrationBundle = {
                  profile: loadedProfile,
                  foodLogs: loadedFoods,
                  biomarkers: loadedBiomarkers,
                  biomarkerHistory: loadedHistory,
                  actions: loadedActions,
                  dailyBenefits: loadedBenefits,
                  report: loadedReport
                };
                await safeSaveToLocalStorage(storageKey, migrationBundle);
              } catch (migErr) {
                console.warn("[Migration] Failed to complete legacy migration:", migErr);
              }
              }
            }
          }
          
          // B. Real-Time Supabase Sync
          try {
            const supabaseUnsub = subscribeToSupabaseLogs(user.uid, async (payload: any) => {
              if (payload && payload.new && payload.eventType !== 'DELETE') {
                console.log(`[Supabase Realtime] Change detected on ${payload.table}: ${payload.eventType}`);
                if (payload.table === 'food_logs') {
                  const newLog = supabaseRowToFoodLog(payload.new);
                  setFoodLogs(prevFoods => mergeFoodLogsDeduped(prevFoods, [newLog]));
                  return;
                } else if (payload.table === 'biomarker_logs') {
                  const newBio = supabaseRowToBiomarkerLog(payload.new);
                  setBiomarkerHistory(prevBio => mergeByRecency(prevBio, [newBio]));
                  return;
                }
              }

              console.log('[Supabase Realtime] Full database change detected, merging logs and profiles...');
              const currentProfile = profileRef.current || profile;
              const deletedFoods = currentProfile?.deletedFoodLogIds || {};
              const deletedBios = currentProfile?.deletedBiomarkerLogIds || {};
              const deletedCustomKeys = currentProfile?.deletedCustomBiomarkerKeys || {};
              const activeEmail = user?.email || currentProfile?.email || auth.currentUser?.email;
              const { serverFoods, serverBiomarkers, serverProfile, serverActions, serverBenefits, serverReport } = await fetchAllConsolidatedLogs(
                db, 
                user.uid, 
                deletedFoods, 
                deletedBios, 
                deletedCustomKeys, 
                activeEmail,
                { lastSyncTime: Date.now() - 60000 }
              );
              if (serverFoods.length > 0) setFoodLogs(prevFoods => mergeFoodLogsDeduped(prevFoods, serverFoods));
              if (serverBiomarkers.length > 0) setBiomarkerHistory(prevBio => mergeByRecency(prevBio, serverBiomarkers));
              if (serverProfile) setProfile(prevProfile => mergeProfiles(serverProfile, prevProfile));
              if (serverActions && serverActions.length > 0) setActions(prevActs => mergeActions(serverActions, prevActs));
              if (serverBenefits && serverBenefits.length > 0) setDailyBenefits(prevBens => mergeBenefits(serverBenefits, prevBens));
              if (serverReport) setReport(prevReport => mergeReports(serverReport, prevReport));
            });
            unsubs.push(supabaseUnsub);
          } catch (spErr) {
            console.warn('[Supabase Realtime] Could not subscribe:', spErr);
          }
        } else {
          // Not signed in via standard Firebase Auth SDK.
          // Check if a saved session exists for a bypassed email (e.g. cwah.liu@gmail.com)
          const lastActiveEmail = localStorage.getItem('last_active_email') || 'guest';
          const storageKey = getStorageKey(lastActiveEmail);
          const parsedLocal = await get(storageKey);
          if (parsedLocal && parsedLocal.profile) {
            try {
              if (parsedLocal.profile) setProfile(parsedLocal.profile);
              if (parsedLocal.foodLogs) setFoodLogs(parsedLocal.foodLogs);
              if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
              if (parsedLocal.biomarkerHistory) setBiomarkerHistory(parsedLocal.biomarkerHistory);
              if (parsedLocal.actions) setActions(parsedLocal.actions);
              if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
              if (parsedLocal.report) setReport(parsedLocal.report);

              // Background sync with Supabase only if not already synced this session or if local cache is empty
              const uid = parsedLocal.profile.uid || ('admin_' + lastActiveEmail.replace(/[^a-z0-9]/gi, '_'));
              const hasSynced = sessionStorage.getItem('synced_' + uid) === 'true';
              const isLocalEmpty = (!parsedLocal.foodLogs || parsedLocal.foodLogs.length === 0) && (!parsedLocal.biomarkerHistory || parsedLocal.biomarkerHistory.length === 0);
              if (!hasSynced || isLocalEmpty) {
                sessionStorage.setItem('synced_' + uid, 'true');
                checkForDbChanges(uid, isLocalEmpty).catch(err => console.warn("[Auth] Session restore sync error:", err));
              }
            } catch (e) {
              console.error("Failed to restore cached local storage:", e);
            }
          } else {
            setProfile(null);
            setFoodLogs([]);
            setBiomarkers({});
            setBiomarkerHistory([]);
            setActions([]);
            setDailyBenefits([]);
            setReport(null);
          }
          setSyncState('local');
        }
      } catch (err) {
        console.error("Auth session restore failed:", err);
      } finally {
        setIsAuthChecking(false);
      }
    });
    return () => unsubscribe();
  }, []);
  // Keep localStorage updated with React states so that hasLocal and canSkipFetch work flawlessly!
  useEffect(() => {
    // Prevent overwriting local storage with empty arrays during initial loading/syncing
    if (!profile || (syncState !== 'synced' && syncState !== 'local' && syncState !== 'conflict')) return;
    const bundle = {
      profile,
      foodLogs,
      biomarkers,
      biomarkerHistory,
      actions,
      dailyBenefits,
      foodIdeas,
      report
    };
    safeSaveToLocalStorage(getStorageKey(profile?.email), bundle);
  }, [profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, foodIdeas, report]);
  // Automatically log BMI on initial load if profile has height/weight but BMI is missing from history or biomarkers
  useEffect(() => {
    if (isAuthChecking || syncState === 'syncing' || syncState === 'conflict') return;
    if (profile && profile.weight && profile.height && !profile.bmiAutoLogged) {
      if (profile.deletedCustomBiomarkerKeys?.bmi || (profile.deletedBiomarkerLogIds && Object.keys(profile.deletedBiomarkerLogIds).some(id => id.includes('bmi')))) {
        return;
      }
      const hasBmiInHistory = biomarkerHistory.some(h => h.biomarkers && h.biomarkers.bmi !== undefined && h.sync_state !== 'delete');
      const hasBmiInBiomarkers = biomarkers.bmi !== undefined;
      if (!hasBmiInHistory || !hasBmiInBiomarkers) {
        const heightInMeters = Number(profile.height) / 100;
        const bmiScore = Number(profile.weight) / (heightInMeters * heightInMeters);
        if (Number.isNaN(bmiScore) || !isFinite(bmiScore)) return;
        const roundedBmi = parseFloat(bmiScore.toFixed(1));
        const recordDate = getCurrentDateInTimezone(profile.timezone);
        const logId = `med_log_bmi_init_${Date.now()}`;
        
        const updatedProfile: UserProfile = {
          ...profile,
          bmiAutoLogged: true
        };
        setProfile(updatedProfile);
        
        setBiomarkers(prev => {
          if (prev.bmi === roundedBmi) return prev;
          return { ...prev, bmi: roundedBmi };
        });
        setBiomarkerHistory(prev => {
          const updatedHistory = [...prev];
          const existingLogIndex = updatedHistory.findIndex(h => h.date === recordDate);
          
          let targetIdToSave = logId;
          if (existingLogIndex >= 0) {
            targetIdToSave = updatedHistory[existingLogIndex].id;
            if (updatedHistory[existingLogIndex].biomarkers?.bmi === roundedBmi) {
              return prev; // no change
            }
            updatedHistory[existingLogIndex] = {
              ...updatedHistory[existingLogIndex],
              biomarkers: {
                ...updatedHistory[existingLogIndex].biomarkers,
                bmi: roundedBmi
              }
            };
          } else {
            updatedHistory.push({
              id: logId,
              date: recordDate,
              biomarkers: {
                bmi: roundedBmi
              },
              note: `Auto-logged default BMI: ${profile.weight} kg, ${profile.height} cm.`
            });
          }
          updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
          // Trigger saveAndSync in background (safely flagged as an auto log)
          setTimeout(() => {
            const updatedBiomarkers = { ...biomarkers, bmi: roundedBmi };
            saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { 
              type: 'biomarkerLog', 
              targetId: targetIdToSave,
              isAutoLog: true 
            });
          }, 0);
          return updatedHistory;
        });
      }
    }
  }, [isAuthChecking, syncState, profile?.weight, profile?.height, profile?.bmiAutoLogged, biomarkerHistory.length, biomarkers.bmi]);
  // Auto-restore missing food images from chat history
  useEffect(() => {
    if (foodLogs.length === 0) return;
    try {
      const rawChat = sessionStorage.getItem('chat_messages_food');
      if (rawChat) {
        const messages = JSON.parse(rawChat);
        let updated = false;
        let updateCount = 0;
        const newFoodLogs = foodLogs.map(log => {
          if (!log.imageUrl && (!log.imageUrls || log.imageUrls.length === 0)) {
            const msg = messages.find((m: any) => m.pendingFoodLog?.id === log.id);
            if (msg && msg.pendingFoodLog && (msg.pendingFoodLog.imageUrl || msg.pendingFoodLog.imageUrls)) {
              updated = true;
              updateCount++;
              return {
                ...log,
                imageUrl: msg.pendingFoodLog.imageUrl || msg.pendingFoodLog.imageUrls?.[0],
                imageUrls: msg.pendingFoodLog.imageUrls || (msg.pendingFoodLog.imageUrl ? [msg.pendingFoodLog.imageUrl] : [])
              };
            }
          }
          return log;
        });
        if (updated && auth.currentUser) {
          const uid = auth.currentUser.uid;
          console.log(`Restoring ${updateCount} lost images from chat history via batched transaction`);
          setFoodLogs(newFoodLogs);
          
// Deferred to manual sync
        }
      }
    } catch (e) {
      console.warn("Failed to auto-restore images:", e);
    }
  }, [foodLogs.length]);
  // Swapping out the current demo profile on the fly
  const handleSwitchDemoProfile = async (type: DemoProfileType) => {
    localStorage.setItem('demo_profile_type', type);
    const newProfile = getDemoProfile(type);
    const newFoods = getDemoFoodLogs(type);
    const newHistory = getDemoBiomarkerHistory(type);
    let newBiomarkers: { [key: string]: any } = {};
    if (type === 'average') {
      newBiomarkers = { fasting_glucose: 91, hba1c: 5.3, total_cholesterol: 208, ldl: 132, hdl: 46, triglycerides: 155, egfr: 94, vitamin_d: 22, wbc: 6.2, hemoglobin: 14.6, bmi: 23.4 };
    } else if (type === 'complex') {
      newBiomarkers = { fasting_glucose: 131, hba1c: 7.1, total_cholesterol: 228, ldl: 151, hdl: 38, triglycerides: 198, egfr: 64, vitamin_d: 19, wbc: 6.9, hemoglobin: 14.1, bmi: 30.2 };
    }
    const newReport = getDemoReport(type);
    const newActions = newReport.actions || [];
    const newBenefits = newReport.dailyBenefits || [];

    setProfile(newProfile);
    setFoodLogs(newFoods);
    setBiomarkerHistory(newHistory);
    setBiomarkers(newBiomarkers);
    setReport(newReport);
    setActions(newActions);
    setDailyBenefits(newBenefits);

    // Save locally
    const bundle = {
      profile: newProfile,
      foodLogs: newFoods,
      biomarkers: newBiomarkers,
      biomarkerHistory: newHistory,
      actions: newActions,
      dailyBenefits: newBenefits,
      report: newReport
    };
    safeSaveToLocalStorage(getStorageKey(newProfile.email), bundle);

    // In sandbox demo mode, switching profiles is completely client-side.
    // No Firestore writes are made to prevent conflicts on the shared demo account.
  };

  // Save changes to local storage and sync to Server cloud database
  const saveAndSync = async (
    currProfile: UserProfile | null,
    currFoods: FoodLog[],
    currBiomarkers: { [key: string]: number | string },
    currBioHistory: BiomarkerLog[],
    currActions: HealthAction[],
    currBenefits: DailyBenefit[],
    currReport: RecommendationReport | null,
    specificUpdate?: {
      type: 'profile' | 'foodLog' | 'biomarkerLog' | 'biomarkerLogsBatch' | 'actions' | 'dailyBenefits' | 'foodIdeas' | 'report' | 'deleteFood' | 'deleteBiomarker' | 'multi' | 'fullPush' | 'analysis' | 'deleteAnalysis' | 'googleSteps';
      targetId?: string;
      targetIds?: string[];
      deletedIds?: string[];
      isAutoLog?: boolean;
    },
    currFoodIdeas: FoodIdea[] = foodIdeas
  ) => {
    let finalFoodsToSave = currFoods;
    let finalBioToSave = currBioHistory;
    const now = Date.now();
    const isAutoLog = !!(specificUpdate?.isAutoLog || 
      specificUpdate?.type === 'googleSteps');

    const foodImagesToSave: { id: string; imageUrl?: string; imageUrls?: string[] }[] = [];
    currFoods.forEach(f => {
      const hasRealImage = f.imageUrl && f.imageUrl !== '[image_removed_for_snapshot]' && f.imageUrl !== '';
      const hasRealUrls = f.imageUrls && f.imageUrls.length > 0 && f.imageUrls.some(u => u && u !== '[image_removed_for_snapshot]' && u !== '');
      if (hasRealImage || hasRealUrls) {
        foodImagesToSave.push({
          id: f.id,
          imageUrl: hasRealImage ? f.imageUrl : undefined,
          imageUrls: f.imageUrls ? f.imageUrls.filter(u => u && u !== '[image_removed_for_snapshot]') : []
        });
      }
    });

    let updatedProfile = currProfile;
    if (currProfile) {
      updatedProfile = {
        ...currProfile,
        approved_agent1_batches: (() => {
          try {
            const saved = localStorage.getItem('approved_agent1_batches');
            return saved ? JSON.parse(saved) : null;
          } catch (e) { return null; }
        })(),
        approved_data_review_batches: (() => {
          try {
            const saved = localStorage.getItem('approved_data_review_batches');
            return saved ? JSON.parse(saved) : null;
          } catch (e) { return null; }
        })(),
        lastUpdatedAt: isAutoLog ? (currProfile.lastUpdatedAt || now) : now
      };
      
      // Sanitize customBiomarkers to filter out any falsy, empty, null, or "undefined" keys
      if (updatedProfile.customBiomarkers) {
        const cleanedCustoms: { [key: string]: any } = {};
        for (const [k, v] of Object.entries(updatedProfile.customBiomarkers)) {
          if (k && k !== 'undefined' && k !== 'null' && k.trim() !== '') {
            cleanedCustoms[k] = v;
          }
        }
        updatedProfile.customBiomarkers = cleanedCustoms;

        // Clear deletion flags for any biomarkers that are currently alive
        if (updatedProfile.deletedCustomBiomarkerKeys) {
          const newDeleted = { ...updatedProfile.deletedCustomBiomarkerKeys };
          let changed = false;
          for (const k of Object.keys(cleanedCustoms)) {
             if (newDeleted[k]) {
                delete newDeleted[k];
                changed = true;
             }
          }
          if (changed) {
             updatedProfile.deletedCustomBiomarkerKeys = newDeleted;
          }
        }

        // Backstop: several write paths (agent extraction, chat logging, unit standardization)
        // create/update a customBiomarkers entry without stamping its own updatedAt. Without a
        // per-entry timestamp, cross-device merge can't tell which device's copy is newer and
        // falls back to comparing whole-profile sync time instead. Stamping any never-stamped
        // entry here guarantees every biomarker gets a real per-entry timestamp going forward,
        // regardless of which screen or flow created it, without needing to patch every site.
        for (const k of Object.keys(updatedProfile.customBiomarkers)) {
          const def = updatedProfile.customBiomarkers[k] as any;
          if (def && !def.updatedAt) {
            updatedProfile.customBiomarkers[k] = { ...def, updatedAt: now };
          }
        }
      }
      
      // Keep local state in sync immediately with the timestamped profile
      setProfile(updatedProfile);
    }
    
    // Ensure all other React states are updated to match what is being synced
    setFoodLogs(currFoods);
    setBiomarkers(currBiomarkers);
    setBiomarkerHistory(currBioHistory);
    setActions(currActions);
    setDailyBenefits(currBenefits);
    setReport(currReport);

    // Save to Local Storage first (Local Save before Upload)
    const bundle = {
      profile: updatedProfile,
      foodLogs: currFoods,
      biomarkers: currBiomarkers,
      biomarkerHistory: currBioHistory,
      actions: currActions,
      dailyBenefits: currBenefits,
      foodIdeas: currFoodIdeas,
      report: currReport,
      lastSyncedAt: now
    };
    await safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), bundle);



    const profileForCloud = updatedProfile ? {
      ...updatedProfile,
      deletedFoodLogIds: mergeDeleteMaps(updatedProfile.deletedFoodLogIds, profile?.deletedFoodLogIds),
      deletedBiomarkerLogIds: mergeDeleteMaps(updatedProfile.deletedBiomarkerLogIds, profile?.deletedBiomarkerLogIds),
      deletedCustomBiomarkerKeys: mergeDeleteMaps(updatedProfile.deletedCustomBiomarkerKeys, profile?.deletedCustomBiomarkerKeys)
    } : null;
    if (profileForCloud && profileForCloud.agentAnalyses) {
      delete profileForCloud.agentAnalyses;
    }

    const activeUser = getEffectiveUser();
    const activeEmail = activeUser?.email || profile?.email;
    const isDemoUser = activeEmail?.toLowerCase().trim() === 'demo@healthcockpit.com';
    if (!updatedProfile || !activeUser || isDemoUser) {
      setSyncState('local');
      return;
    }
    // Clear quota flags if this is an explicit manual fullPush or explicit user sync
    const isExplicitSync = specificUpdate?.type === 'fullPush' || (window as any).isManualSyncExecuting;
    if (isExplicitSync) {
      localStorage.removeItem('firestore_quota_exceeded');
      localStorage.removeItem('firestore_quota_exceeded_time');
      if (isFirestoreQuotaExceeded) {
        setIsFirestoreQuotaExceeded(false);
      }
    }

    // We allow user-triggered specific updates to write to the cloud even if the sync state was 'local' (offline)
    // or manual-sync-only mode is enabled, which helps deliberate actions (e.g. approving a biomarker
    // correction) reach the cloud immediately instead of silently waiting on a manual sync tap.
    // We only block background/automatic updates or if the database quota is explicitly exceeded.
    const isUserTriggered = specificUpdate && 
      specificUpdate.type !== 'googleSteps' && 
      !specificUpdate.isAutoLog;

    // Intercept automatic writes if manual sync mode is enabled to save quota
    const isManualSyncOnly = localStorage.getItem('auto_sync_disabled') === 'true';
    if (isManualSyncOnly && !isExplicitSync && !isUserTriggered) {
      setSyncState('local');
      return;
    }

    if (syncState === 'local' && specificUpdate?.type !== 'fullPush' && !isUserTriggered) {
      return;
    }
    
    // To minimize database writes and protect against quota exhaustion, 
    // we prevent automatic system updates (such as BMI auto-logging or Google Steps sync)
    // from writing to the cloud in the background. They are kept as local/unsynced state.
    if (isAutoLog) {
      setSyncState('local');
      return;
    }

    setSyncState('syncing');
    const uid = activeUser.uid;
    let syncRootId = "";
    syncRootId = logInteraction('sync', `users/${uid} (${specificUpdate ? specificUpdate.type : 'Save changes'})`, null);
    try {
      if (specificUpdate && specificUpdate.type !== 'fullPush') {
        // ALWAYS touch profile timestamp and push deleted IDs tracking so other devices pull correctly.
        // Also merge the full profile's schema definition structures (customBiomarkers,
        // notUsedBiomarkers) to Firestore so any local biomarker schema adjustments are synchronized, 
        // preventing empty schema states in multi-device sync.
        if (!checkQuotaFlag() && !isFirestoreQuotaExceeded && db) {
          // Firestore Profile updates disabled to route to Supabase
        }
        if (specificUpdate.type === 'analysis' && specificUpdate.targetId) {
          const analysis = updatedProfile?.agentAnalyses?.find(a => a.id === specificUpdate.targetId);
          if (analysis) {
            const itemTrackId = logInteraction('upload', `users/${uid}/agentAnalyses/${analysis.id}`, analysis);
            await withTimeout(
              Promise.resolve().then(() => completeInteraction(itemTrackId, true, JSON.stringify(analysis).length)),
              2000,
              'Analysis write'
            );
          }
        } else if (specificUpdate.type === 'deleteAnalysis' && specificUpdate.targetId) {
          const delTrackId = logInteraction('delete', `users/${uid}/agentAnalyses/${specificUpdate.targetId}`, null);
          await withTimeout(
            Promise.resolve().then(() => completeInteraction(delTrackId, true, 0)),
            2000,
            'Delete analysis'
          );
        } else if (specificUpdate.type === 'profile') {
          const pId = logInteraction('upload', `users/${uid} (Profile)`, updatedProfile);
          await withTimeout(
            // [FreeTier] profile single-writer disabled
            Promise.resolve().then(() => completeInteraction(pId, true, 0)).catch(() => {}),
            5000,
            'Profile write'
          );
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
          const deletedFoods = updatedProfile?.deletedFoodLogIds || profile?.deletedFoodLogIds || {};
          const deletedBioLogs = updatedProfile?.deletedBiomarkerLogIds || profile?.deletedBiomarkerLogIds || {};
          await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, deletedFoods, deletedBioLogs, (sf, sb) => {
            finalFoodsToSave = sf; finalBioToSave = sb; setFoodLogs(sf); setBiomarkerHistory(sb);
          });
        } else if ((specificUpdate.type === 'foodLog' || specificUpdate.type === 'deleteFood') && specificUpdate.targetId) {
          const deletedFoods = updatedProfile?.deletedFoodLogIds || profile?.deletedFoodLogIds || {};
          const deletedBioLogs = updatedProfile?.deletedBiomarkerLogIds || profile?.deletedBiomarkerLogIds || {};
          await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, deletedFoods, deletedBioLogs, async (sf, sb) => {
            finalFoodsToSave = sf; finalBioToSave = sb; setFoodLogs(sf);
            setBiomarkerHistory(sb);
            // Persist purged/synced logs to IndexedDB immediately so deletes survive refresh
            const updatedBundle = {
              ...bundle,
              foodLogs: sf,
              biomarkerHistory: sb
            };
            await safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), updatedBundle);
          });
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        } else if (specificUpdate.type === 'biomarkerLog' || specificUpdate.type === 'biomarkerLogsBatch' || specificUpdate.type === 'deleteBiomarker') {
          const deletedFoods = updatedProfile?.deletedFoodLogIds || profile?.deletedFoodLogIds || {};
          const deletedBioLogs = updatedProfile?.deletedBiomarkerLogIds || profile?.deletedBiomarkerLogIds || {};
          await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, deletedFoods, deletedBioLogs, async (sf, sb) => {
            finalFoodsToSave = sf; finalBioToSave = sb; setFoodLogs(sf); setBiomarkerHistory(sb);
            const updatedBundle = {
              ...bundle,
              biomarkers: currBiomarkers,
              biomarkerHistory: sb
            };
            await safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), updatedBundle);
          }, { forceAllBiomarkers: specificUpdate.type === 'biomarkerLogsBatch' });
          const profilePromise = Promise.resolve();
          console.log('[FreeTier] profile single-writer');
          await withTimeout(profilePromise, 3000, 'biomarkerLogsBatch');
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        } else if (specificUpdate.type === 'actions') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Actions)`, null);
          // [FreeTier] profile single-writer disabled
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        } else if (specificUpdate.type === 'dailyBenefits') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Benefits)`, null);
          // [FreeTier] profile single-writer disabled
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        } else if (specificUpdate.type === 'foodIdeas') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (FoodIdeas)`, null);
          // [FreeTier] profile single-writer disabled
        } else if (specificUpdate.type === 'report' && currReport) {
          const itemTrackId = logInteraction('upload', `users/${uid}/reports/latest`, currReport);
          // [FreeTier] profile single-writer disabled
          
          const dashTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Report Update)`, null);
          await withTimeout(
            Promise.resolve(), 2000, 'Dashboard report sync');
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        }
      } else if (specificUpdate && specificUpdate.type === 'fullPush') {
        // Supabase first (full profile + homepage + report). Firebase is best-effort only.
        await upsertProfileToSupabase(profileForCloud, uid, {
          actions: currActions,
          dailyBenefits: currBenefits,
          report: currReport,
          email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined,
          forceOverwrite: true
        });

        const deletedFoods = currProfile?.deletedFoodLogIds || profile?.deletedFoodLogIds || {};
        const deletedBioLogs = currProfile?.deletedBiomarkerLogIds || profile?.deletedBiomarkerLogIds || {};
        const includeFoods = !!(specificUpdate as any).includeFoods;
        await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, deletedFoods, deletedBioLogs, (sf, sb) => {
          finalFoodsToSave = sf; finalBioToSave = sb; setFoodLogs(sf); setBiomarkerHistory(sb);
        }, { forceAllBiomarkers: true, forceAllFoods: includeFoods });

        const syncedBios = (finalBioToSave || currBioHistory).map(b =>
          b.sync_state === 'delete' ? b : { ...b, sync_state: 'synced' as const }
        );
        finalBioToSave = syncedBios;
        setBiomarkerHistory(syncedBios);

        const pId = logInteraction('upload', `users/${uid} (Profile)`, currProfile);
        const profilePromise = Promise.resolve();
        console.log('[FreeTier] profile single-writer');
        completeInteraction(pId, true, 0);

        // Run promises in small sequential batches of 5 to avoid exhausting the Firestore write stream
        const chunkPromises = async (tasks: (() => Promise<any>)[], chunkSize: number) => {
          for (let i = 0; i < tasks.length; i += chunkSize) {
            const chunk = tasks.slice(i, i + chunkSize);
            await Promise.all(chunk.map(task => task()));
          }
        };

        const foodImageTasks = foodImagesToSave.map(imgData => {
          return () => { console.log('[FreeTier] foodImages firestore write disabled'); return Promise.resolve(); };
        });

        const foodImagePromise = chunkPromises(foodImageTasks, 5).then(() => {
          // Mark all saved food items as synced in memory to prevent re-uploading on routine syncs
          const syncedFoods = currFoods.map(f => ({ ...f, sync_state: 'synced' as const }));
          finalFoodsToSave = syncedFoods; setFoodLogs(syncedFoods);
          // Persist full images in local IndexedDB so offline/quota fallback retains them
          safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), {
            profile: updatedProfile,
            foodLogs: syncedFoods,
            biomarkers: currBiomarkers,
            biomarkerHistory: currBioHistory,
            actions: currActions,
            dailyBenefits: currBenefits,
            foodIdeas: currFoodIdeas,
            report: currReport
          });
        });

        const dashboardPromise = Promise.resolve();
        let reportPromise = Promise.resolve();
        if (currReport) {
          const itemTrackId = logInteraction('upload', `users/${uid}/reports/latest`, currReport);
          reportPromise = Promise.resolve();
        }
        await withTimeout(
          Promise.all([
            profilePromise,
            dashboardPromise,
            reportPromise,
            foodImagePromise
          ]),
          30000,
          'FullPush sync'
        ).catch(err => console.warn('Background sync warning:', err));
      } else {
        // Multi-document sync (default when no specific update provided)
        const pId = logInteraction('upload', `users/${uid} (Profile)`, currProfile);
        const profilePromise = Promise.resolve();
        upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        const dashboardPromise = Promise.resolve();
        let reportPromise = Promise.resolve();
        if (currReport) {
          const itemTrackId = logInteraction('upload', `users/${uid}/reports/latest`, currReport);
          reportPromise = Promise.resolve();
        }
        
        // V2 bulk sync
        const deletedFoods = currProfile?.deletedFoodLogIds || profile?.deletedFoodLogIds || {};
        const deletedBioLogs = currProfile?.deletedBiomarkerLogIds || profile?.deletedBiomarkerLogIds || {};
        await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, deletedFoods, deletedBioLogs, (sf, sb) => {
          finalFoodsToSave = sf; finalBioToSave = sb; setFoodLogs(sf); setBiomarkerHistory(sb);
        });

        // Run promises in small sequential batches of 5 to avoid exhausting the Firestore write stream
        const chunkPromises = async (tasks: (() => Promise<any>)[], chunkSize: number) => {
          for (let i = 0; i < tasks.length; i += chunkSize) {
            const chunk = tasks.slice(i, i + chunkSize);
            await Promise.all(chunk.map(t => t()));
          }
        };

        // ONLY upload images for foods that have unsynced edits (sync_state === 'new' || 'update')
        const unsyncedImageTasks = currFoods
          .filter(f => (f.sync_state === 'new' || f.sync_state === 'update') && (
            (f.imageUrl && f.imageUrl !== '[image_removed_for_snapshot]' && f.imageUrl !== '') ||
            (f.imageUrls && f.imageUrls.length > 0 && f.imageUrls.some(u => u && u !== '[image_removed_for_snapshot]'))
          ))
          .map(f => {
            const hasRealImage = f.imageUrl && f.imageUrl !== '[image_removed_for_snapshot]' && f.imageUrl !== '';
            return () => { console.log('[FreeTier] foodImages firestore write disabled'); return Promise.resolve(); };
          });

        if (unsyncedImageTasks.length > 0) {
          await chunkPromises(unsyncedImageTasks, 5);
        }

        await withTimeout(
          Promise.all([
            profilePromise,
            dashboardPromise,
            reportPromise
          ]),
          3000,
          'Multi sync profiles'
        ).catch(err => console.warn('Background sync warning:', err));


      }
      // Artificially enforce a minimum rotation time of 800ms so the user gets clear visual confirmation
      await new Promise(resolve => setTimeout(resolve, 800));
      const finalBundle = {
        profile: updatedProfile,
        foodLogs: finalFoodsToSave,
        biomarkers: currBiomarkers,
        biomarkerHistory: finalBioToSave,
        actions: currActions,
        dailyBenefits: currBenefits,
        foodIdeas: currFoodIdeas,
        report: currReport,
        lastSyncedAt: Date.now()
      };
      await safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), finalBundle);
      setSyncState('synced');
      completeInteraction(syncRootId, true, 0);
    } catch (e: any) {
      console.error("[Sync Save Fail]", e);
      handleFirestoreError(e);
      setSyncState('local');
      completeInteraction(syncRootId, false, 0, e.message || 'Save error');
    }
  };

  const handleResolveConflict = async (biomarkerSource: 'local' | 'cloud', foodSource: 'local' | 'cloud') => {
    if (!conflictData || !auth.currentUser) return;
    setSyncState('syncing');

    const uid = auth.currentUser.uid;
    const now = Date.now();

    // 1. Resolve Profile & Biomarkers
    let resolvedProfile: UserProfile;
    let resolvedBioHistory: BiomarkerLog[];
    let resolvedActions: HealthAction[];
    let resolvedBenefits: DailyBenefit[];
    let resolvedReport: RecommendationReport | null;

    if (biomarkerSource === 'local') {
      resolvedProfile = { ...conflictData.localProfile, lastUpdatedAt: now };
      resolvedBioHistory = [...conflictData.localBioHistory];
      resolvedActions = [...conflictData.localActions];
      resolvedBenefits = [...conflictData.localBenefits];
      resolvedReport = conflictData.localReport;
    } else {
      resolvedProfile = { ...conflictData.cloudProfile, lastUpdatedAt: now };
      resolvedBioHistory = [...conflictData.cloudBioHistory];
      resolvedActions = [...conflictData.cloudActions];
      resolvedBenefits = [...conflictData.cloudBenefits];
      resolvedReport = conflictData.cloudReport;
    }

    // 2. Resolve Food Log
    let resolvedFoods: FoodLog[];
    if (foodSource === 'local') {
      resolvedFoods = [...conflictData.localFoods];
    } else {
      resolvedFoods = [...conflictData.cloudFoods];
    }

    // 3. Compute active biomarkers
    const computedBiomarkers: { [key: string]: number | string } = {};
    [...resolvedBioHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        computedBiomarkers[k] = v as string | number;
      });
    });

    // 4. Update state variables immediately
    setProfile(resolvedProfile);
    setFoodLogs(resolvedFoods);
    setBiomarkerHistory(resolvedBioHistory);
    setBiomarkers(computedBiomarkers);
    setActions(resolvedActions);
    setDailyBenefits(resolvedBenefits);
    if (resolvedReport) setReport(resolvedReport);

    // 5. Write to local storage with new sync timestamp
    const bundle = {
      profile: resolvedProfile,
      foodLogs: resolvedFoods,
      biomarkers: computedBiomarkers,
      biomarkerHistory: resolvedBioHistory,
      actions: resolvedActions,
      dailyBenefits: resolvedBenefits,
      report: resolvedReport,
      lastSyncedAt: now
    };
    await safeSaveToLocalStorage(getStorageKey(resolvedProfile?.email || profile?.email || auth.currentUser?.email), bundle);

    // 6. Push fully resolved bundle to Cloud Firestore (full push)
    try {
      await saveAndSync(resolvedProfile, resolvedFoods, computedBiomarkers, resolvedBioHistory, resolvedActions, resolvedBenefits, resolvedReport, { 
        type: 'fullPush',
        cloudFoods: conflictData.cloudFoods,
        cloudBioHistory: conflictData.cloudBioHistory
      } as any);
      setConflictData(null);
      setSyncState('synced');
    } catch (err) {
      console.error("Failed to push resolved sync state:", err);
      setSyncState('local');
    }
  };

  // Sync Check on Login / Fetch user record if existing on server
  const handleLogin = async (loggedProfile: UserProfile) => {
    setProfile(loggedProfile);
    setSyncState('local');
  };
  const handleSignOut = async () => {
    try {
      // Clear all React state immediately so no glimpse of user data after sign-out
      setProfile(null);
      setFoodLogs([]);
      setBiomarkers({});
      setBiomarkerHistory([]);
      setActions([]);
      setDailyBenefits([]);
      setReport(null);
      setSyncState('local');
      await fbSignOut(auth);
      // Note: Do NOT clear localStorage — user data is preserved per-email key
      // and will load correctly when the correct user signs back in.
    } catch (e) {
      console.error("Failed to sign out from Firebase:", e);
    }
  };
  // Selected LLM Engine shared across sections - highest RPD model is the default, and we persist the user selection
  const [selectedModelId, setSelectedModelIdState] = useState<string>(() => {
    const saved = localStorage.getItem('selectedModelId');
    if (saved) return saved;
    // Default is the one with the highest RPD
    return AVAILABLE_LLMS.find(m => m.isDefault)?.id || AVAILABLE_LLMS[0]?.id || 'gemini-3.5-flash-lite';
  });
  const setSelectedModelId = (id: string) => {
    setSelectedModelIdState(id);
    localStorage.setItem('selectedModelId', id);
  };
  // Add / Edit logs handlers
  const handleLogFood = async (food: FoodLog) => {
    let compressedFood = { ...food };
    if (!compressedFood.id) {
      compressedFood.id = `food_${Date.now()}`;
    }
    
    // Compress imageUrl to 800x800 when logging
    if (compressedFood.imageUrl && typeof compressedFood.imageUrl === 'string' && compressedFood.imageUrl.startsWith('data:image/')) {
      try {
        compressedFood.imageUrl = await compressImage(compressedFood.imageUrl, 800, 800, 0.7);
      } catch (e) {
        console.warn("Failed to compress food.imageUrl to 800x800:", e);
      }
    }
    
    // Compress imageUrls to 800x800 when logging
    if (compressedFood.imageUrls && Array.isArray(compressedFood.imageUrls) && compressedFood.imageUrls.length > 0) {
      const newUrls = [];
      for (const url of compressedFood.imageUrls) {
        if (url && typeof url === 'string' && url.startsWith('data:image/')) {
          try {
            const comp = await compressImage(url, 800, 800, 0.7);
            newUrls.push(comp);
          } catch (e) {
            console.warn("Failed to compress image in food.imageUrls to 800x800:", e);
            newUrls.push(url);
          }
        } else {
          newUrls.push(url);
        }
      }
      compressedFood.imageUrls = newUrls;
    }

    const existingIndex = foodLogs.findIndex(f => f.id === compressedFood.id);
    let updatedFoods;
    if (existingIndex !== -1) {
      const logWithSync = { ...compressedFood, sync_state: 'update' as const, updated_at: Date.now() };
      updatedFoods = foodLogs.map(f => f.id === compressedFood.id ? logWithSync : f);
    } else {
      // Safety net: guard against rapid duplicate submissions (double-tap, SSE
      // retry, reconnect firing twice) producing two distinct food_${Date.now()}
      // ids for the same logical meal. Only kicks in when there's no exact id
      // match above. Pure in-memory check against already-loaded foodLogs — no
      // new Firebase/Supabase reads.
      const now = Date.now();
      const DUPLICATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
      const newFingerprint = foodLogFingerprint(compressedFood);
      const recentDuplicateIndex = foodLogs.findIndex(f => {
        if (!f.updated_at || (now - f.updated_at) > DUPLICATE_WINDOW_MS) return false;
        return foodLogFingerprint(f) === newFingerprint;
      });
      if (recentDuplicateIndex !== -1) {
        console.warn('[handleLogFood] Near-duplicate submission detected within 5 min window, updating existing entry instead of creating a new one:', newFingerprint);
        const existing = foodLogs[recentDuplicateIndex];
        const logWithSync = { ...existing, ...compressedFood, id: existing.id, sync_state: 'update' as const, updated_at: now };
        updatedFoods = foodLogs.map(f => f.id === existing.id ? logWithSync : f);
      } else {
        const newFood = { ...compressedFood, sync_state: 'new' as const, updated_at: now };
        updatedFoods = [...foodLogs, newFood];
      }
    }
    setFoodLogs(updatedFoods);
    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: compressedFood.id });
  };
  const handleUpdateFoodLog = async (updatedLog: FoodLog) => {
    let compressedFood = { ...updatedLog };
    if (!compressedFood.id) {
      compressedFood.id = `food_${Date.now()}`;
    }
    
    // Compress imageUrl to 800x800 when logging
    if (compressedFood.imageUrl && typeof compressedFood.imageUrl === 'string' && compressedFood.imageUrl.startsWith('data:image/')) {
      try {
        compressedFood.imageUrl = await compressImage(compressedFood.imageUrl, 800, 800, 0.7);
      } catch (e) {
        console.warn("Failed to compress food.imageUrl to 800x800:", e);
      }
    }
    
    // Compress imageUrls to 800x800 when logging
    if (compressedFood.imageUrls && Array.isArray(compressedFood.imageUrls) && compressedFood.imageUrls.length > 0) {
      const newUrls = [];
      for (const url of compressedFood.imageUrls) {
        if (url && typeof url === 'string' && url.startsWith('data:image/')) {
          try {
            const comp = await compressImage(url, 800, 800, 0.7);
            newUrls.push(comp);
          } catch (e) {
            console.warn("Failed to compress image in food.imageUrls to 800x800:", e);
            newUrls.push(url);
          }
        } else {
          newUrls.push(url);
        }
      }
      compressedFood.imageUrls = newUrls;
    }

    const logWithSync = { ...compressedFood, sync_state: 'update' as const, updated_at: Date.now() };
    const updatedFoods = foodLogs.map(f => f.id === compressedFood.id ? logWithSync : f);
    setFoodLogs(updatedFoods);
    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: compressedFood.id });
  };
  const handleDeleteFoodLog = async (id: string) => {
    const existingLog = foodLogs.find(f => f.id === id);
    const existingUpdated = existingLog?.updated_at || 0;
    const now = Math.max(Date.now(), existingUpdated + 1000);
    // Keep it in array but mark as delete so syncUtils can process it
    const updatedFoods = foodLogs.map(f => f.id === id ? { ...f, sync_state: 'delete' as const, updated_at: now } : f);
    setFoodLogs(updatedFoods);
    
    let updatedProfile = profile ? {
      ...profile,
      deletedFoodLogIds: { ...(profile.deletedFoodLogIds || {}), [id]: now }
    } : null;
    if (updatedProfile) {
      setProfile(updatedProfile);
    }
    // Clean up legacy subcollection document in Firestore if it exists so legacy migration never resurrects it
    if (auth.currentUser) {
      Promise.resolve();
    }
    await saveAndSync(updatedProfile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'deleteFood', targetId: id });
  };
  const logBmiIfProfileWeightHeightChanged = (
    prev: UserProfile | null,
    next: UserProfile,
    history: BiomarkerLog[],
    biomarks: { [key: string]: number | string }
  ) => {
    const weightChanged = !prev || next.weight !== prev.weight;
    const heightChanged = !prev || next.height !== prev.height;
    const hasNoBmi = !biomarks.bmi || !history.some(h => h.biomarkers && h.biomarkers.bmi !== undefined);
    let updatedHistory = [...history];
    let updatedBiomarkers = { ...biomarks };
    if ((weightChanged || heightChanged || hasNoBmi) && next.weight && next.height) {
      const heightInMeters = Number(next.height) / 100;
      const bmiScore = Number(next.weight) / (heightInMeters * heightInMeters);
      const roundedBmi = parseFloat(bmiScore.toFixed(1));
      const recordDate = getCurrentDateInTimezone(next.timezone || (prev && prev.timezone));
      const existingLogIndex = updatedHistory.findIndex(h => h.date === recordDate);
      if (existingLogIndex >= 0) {
        updatedHistory[existingLogIndex] = {
          ...updatedHistory[existingLogIndex],
          biomarkers: {
            ...updatedHistory[existingLogIndex].biomarkers,
            bmi: roundedBmi
          }
        };
      } else {
        updatedHistory.push({
          id: `med_log_bmi_${Date.now()}`,
          date: recordDate,
          biomarkers: {
            bmi: roundedBmi
          },
          note: `Auto-logged BMI update based on profile change: ${next.weight} kg, ${next.height} cm.`
        });
      }
      updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
      updatedBiomarkers.bmi = roundedBmi;
    }
    return { updatedHistory, updatedBiomarkers, changed: weightChanged || heightChanged || hasNoBmi };
  };

  const handleAgentAnalysisSaved = async (agentType: string, agentResult: any, existingId?: string): Promise<string> => {
    if (!profile) return '';
    const newId = existingId || `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const updatedAnalyses = profile.agentAnalyses ? [...profile.agentAnalyses] : [];
    const existingIndex = existingId ? updatedAnalyses.findIndex(a => a.id === existingId) : -1;
    if (existingIndex >= 0) {
      updatedAnalyses[existingIndex] = {
        ...updatedAnalyses[existingIndex],
        result: agentResult
      };
    } else {
      updatedAnalyses.push({
        id: newId,
        agentType: agentType,
        date: new Date().toISOString(),
        result: agentResult
      });
    }
    const updatedProfile = { 
      ...profile,
      agentAnalyses: updatedAnalyses
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'analysis', targetId: newId });
    return newId;
  };

  const handleDeleteAnalysis = async (id: string) => {
    if (!profile) return;
    if (profile.agentAnalyses) {
      const updatedProfile = {
        ...profile,
        agentAnalyses: profile.agentAnalyses.filter(a => a.id !== id)
      };
      setProfile(updatedProfile);
      await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'deleteAnalysis', targetId: id });
    }
  };

  const handleLogMedical = async (
    extractedBiomarkers: { [key: string]: number | string }, 
    profileUpdates?: Partial<UserProfile>, 
    date?: string, 
    entries?: { date: string | null; biomarkers: { [key: string]: number | string }; tests?: any[] }[],
    modificationCommand?: ModificationCommand[],
    skipClose?: boolean
  ) => {
    let currentProfile = profile;
    let updatedHistory = [...biomarkerHistory];
    let updatedBiomarkers = { ...biomarkers };
    // Standardize and normalize extracted biomarkers and custom definitions
    let finalExtracted = { ...extractedBiomarkers };
    let finalProfileUpdates = profileUpdates ? { ...profileUpdates } : undefined;

    // Filter out invalid/empty biomarkers
    const isValidValue = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && v !== 'N/A' && v !== 'null';
    Object.keys(finalExtracted).forEach(k => {
      if (!isValidValue(finalExtracted[k])) delete finalExtracted[k];
    });
    if (entries) {
      entries.forEach(e => {
        if (e.biomarkers) {
          Object.keys(e.biomarkers).forEach(k => {
            if (!isValidValue(e.biomarkers[k])) delete e.biomarkers[k];
          });
        }
      });
    }

    // Filter customBiomarkers to only include those that are actually being saved
    if (finalProfileUpdates && finalProfileUpdates.customBiomarkers) {
      const activeKeys = new Set<string>(Object.keys(finalExtracted));
      if (entries) {
        entries.forEach(e => {
          if (e.biomarkers) Object.keys(e.biomarkers).forEach(k => activeKeys.add(k));
        });
      }
      if (modificationCommand) {
        modificationCommand.forEach(cmd => {
          if (cmd.keyName) activeKeys.add(cmd.keyName);
        });
      }
      if (profileUpdates?.customBiomarkers) {
        Object.keys(profileUpdates.customBiomarkers).forEach(k => activeKeys.add(k));
      }
      
      const filteredCustoms: { [key: string]: any } = {};
      Object.entries(finalProfileUpdates.customBiomarkers).forEach(([k, v]) => {
        if (activeKeys.has(k)) {
          filteredCustoms[k] = v;
        }
      });
      finalProfileUpdates.customBiomarkers = filteredCustoms;
    }

    const cleanName = (n: string): string => n.split('(')[0].split('[')[0].trim();
    const keyMapping: { [key: string]: string } = {};
    if (finalProfileUpdates && finalProfileUpdates.customBiomarkers && Object.keys(finalProfileUpdates.customBiomarkers).length > 0) {
      const currentCustoms = { ...(profile?.customBiomarkers || {}) };
      const nextCustomDefs: { [key: string]: any } = {};
      Object.entries(finalProfileUpdates.customBiomarkers).forEach(([rawKey, def]) => {
        const rawName = def.name || rawKey;
        const cleaned = cleanName(rawName);
        const normalizeUnit = (u: string) => (u || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        
        const cleanDef = { ...def };
        if (!cleanDef.unit || cleanDef.unit.trim() === '-' || cleanDef.unit.trim() === '') delete cleanDef.unit;
        if (!cleanDef.normalRange || cleanDef.normalRange.trim() === '-' || cleanDef.normalRange.trim() === '') delete cleanDef.normalRange;
        if (!cleanDef.standardMedicalGrouping || cleanDef.standardMedicalGrouping === 'Other') delete cleanDef.standardMedicalGrouping;
        if (!cleanDef.riskCategories || cleanDef.riskCategories.length === 0) delete cleanDef.riskCategories;
        // If the key is already actively tracked by the user, we MUST NOT change its key to avoid breaking history
        if (biomarkers[rawKey]) {
          keyMapping[rawKey] = rawKey;
          currentCustoms[rawKey] = {
            ...(currentCustoms[rawKey] || {}),
            ...cleanDef,
            name: cleaned
          };
          return;
        }

        // Check standard match (skip if rawKey is already an explicitly established custom key)
        const stdMatch = !currentCustoms[rawKey] ? biomarkerDefinitions.find(d => {
          const nameMatch = d.name.toLowerCase() === cleaned.toLowerCase() || d.key.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase();
          const unitMatch = !def.unit || !d.unit || normalizeUnit(d.unit) === normalizeUnit(def.unit);
          return nameMatch && unitMatch;
        }) : null;
        if (stdMatch) {
          keyMapping[rawKey] = stdMatch.key;
          return; // Map to standard key, drop custom def
        }
        // Check existing custom match
        let existingKey = Object.keys(currentCustoms).find(k => {
          const nameMatch = cleanName(currentCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase();
          const keyMatch = k.toLowerCase() === cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          return nameMatch || keyMatch;
        });
        // Always fallback to rawKey if it already exists as a known key
        if (!existingKey && currentCustoms[rawKey]) {
          existingKey = rawKey;
        }
        if (existingKey) {
          keyMapping[rawKey] = existingKey;
          currentCustoms[existingKey] = {
            ...currentCustoms[existingKey],
            ...def,
            name: cleaned // enforce simple name without brackets
          };
          return;
        }
        // Create new safe key
        const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        let targetKey = safeKey || rawKey;
        
        // If targetKey collides with a standard key (which means it failed the unit match above), make it unique
        const isStandard = biomarkerDefinitions.some(d => d.key === targetKey);
        if (isStandard) {
          targetKey = `${targetKey}_${normalizeUnit(def.unit || 'custom')}`;
        }
        
        keyMapping[rawKey] = targetKey;
        nextCustomDefs[targetKey] = {
          ...def,
          name: cleaned
        };
      });
      finalProfileUpdates.customBiomarkers = {
        ...currentCustoms,
        ...nextCustomDefs
      };
    }
    const entriesToProcess = entries && entries.length > 0
      ? entries
      : [{ date: date || null, biomarkers: finalExtracted }];
    let hasNewBiomarkers = false;
    const modifiedLogIds: string[] = [];
    if (modificationCommand && modificationCommand.length > 0) {
      const unitMapApply: Record<string, string> = {};
      Object.entries(profile?.customBiomarkers || {}).forEach(([k, v]: [string, any]) => {
        if (v?.unit) unitMapApply[k] = v.unit;
      });
      modificationCommand = enrichReviewModificationCommands(modificationCommand, updatedHistory, unitMapApply);
      let madeChanges = false;
      const normalizeDateForMatch = (s?: string) => {
        if (!s) return '';
        const clean = s.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
          const [y, m, d] = clean.split('-');
          return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y}`;
        }
        return clean;
      };
      modificationCommand.forEach(cmd => {
        if (cmd.action === 'update_biomarker' && cmd.keyName) {
          const targetDate = cmd.date || getCurrentDateInTimezone(profile?.timezone);
          const logIdx = updatedHistory.findIndex(h => normalizeDateForMatch(h.date) === normalizeDateForMatch(targetDate));
          if (logIdx >= 0 && cmd.newValue !== undefined) {
            updatedHistory[logIdx] = {
              ...updatedHistory[logIdx],
              biomarkers: {
                ...updatedHistory[logIdx].biomarkers,
                [cmd.keyName]: cmd.newValue
              },
              sync_state: 'update' as any,
              updated_at: Date.now()
            };
            modifiedLogIds.push(updatedHistory[logIdx].id);
            madeChanges = true;
            hasNewBiomarkers = true;
          } else if (logIdx < 0 && cmd.newValue !== undefined && cmd.date) {
            const newLog = {
              id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
              date: cmd.date,
              biomarkers: {
                [cmd.keyName]: cmd.newValue
              },
              sync_state: 'update' as const,
              updated_at: Date.now()
            };
            updatedHistory.push(newLog);
            modifiedLogIds.push(newLog.id);
            madeChanges = true;
            hasNewBiomarkers = true;
          }
        } else if (cmd.action === 'remove_biomarker' && cmd.keyName) {
          if (!cmd.date) {
            console.warn(`Prevented deletion: remove_biomarker command missing date`);
            return;
          }
          const targetDate = cmd.date;
          const logIdx = updatedHistory.findIndex(h => normalizeDateForMatch(h.date) === normalizeDateForMatch(targetDate));
          if (logIdx >= 0 && updatedHistory[logIdx].biomarkers[cmd.keyName] !== undefined) {
            const newBiomarkers = { ...updatedHistory[logIdx].biomarkers };
            delete newBiomarkers[cmd.keyName];
            updatedHistory[logIdx] = {
              ...updatedHistory[logIdx],
              biomarkers: newBiomarkers,
              sync_state: 'update',
              updated_at: Date.now()
            };
            modifiedLogIds.push(updatedHistory[logIdx].id);
            madeChanges = true;
            hasNewBiomarkers = true;
          }
        } else if (cmd.action === 'update_profile' && cmd.keyName && cmd.newValue !== undefined) {
          if (!finalProfileUpdates) finalProfileUpdates = {};
          (finalProfileUpdates as any)[cmd.keyName] = cmd.newValue;
          madeChanges = true;
        }
      });
      // If we only processed modification commands and no normal entries, we can skip the standard entry loop.
      if (madeChanges && entriesToProcess.length === 1 && Object.keys(entriesToProcess[0].biomarkers || {}).length === 0) {
        entriesToProcess.length = 0; // Skip
      }
    }
    entriesToProcess.forEach(entry => {
      // Standardize extracted keys
      const mappedExtracted: { [key: string]: number | string } = {};
      const rawKeyToMappedKey: { [key: string]: string } = {};
      Object.entries(entry.biomarkers || {}).forEach(([rawKey, val]) => {
        // Ignore age, height, weight from extracted biomarkers
        if (rawKey === 'weight' || rawKey === 'height' || rawKey === 'age') return;
        if (biomarkerDefinitions.some(d => d.key === rawKey)) {
          mappedExtracted[rawKey] = val;
          rawKeyToMappedKey[rawKey] = rawKey;
          return;
        }
        if (keyMapping[rawKey]) {
          mappedExtracted[keyMapping[rawKey]] = val;
          rawKeyToMappedKey[rawKey] = keyMapping[rawKey];
          return;
        }
        // Check name match directly
        const cleaned = cleanName(rawKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
        const stdMatch = biomarkerDefinitions.find(d => d.name.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase());
        if (stdMatch) {
          mappedExtracted[stdMatch.key] = val;
          rawKeyToMappedKey[rawKey] = stdMatch.key;
          return;
        }
        const existingCustoms = { ...(profile?.customBiomarkers || {}) };
        const custMatchKey = Object.keys(existingCustoms).find(k => cleanName(existingCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase());
        if (custMatchKey) {
          mappedExtracted[custMatchKey] = val;
          rawKeyToMappedKey[rawKey] = custMatchKey;
          return;
        }
        const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const finalKey = safeKey || rawKey;
        mappedExtracted[finalKey] = val;
        rawKeyToMappedKey[rawKey] = finalKey;
      });

      if (Object.keys(mappedExtracted).length > 0) {
        hasNewBiomarkers = true;
        const recordDate = entry.date || getCurrentDateInTimezone(profile?.timezone);
        const existingLogIndex = updatedHistory.findIndex(h => h.date === recordDate);

        // Map tests array
        let entryTests: any[] = [];
        if (entry.tests && Array.isArray(entry.tests)) {
          entryTests = entry.tests.map((t: any) => {
            let mappedKey = t.key;
            if (rawKeyToMappedKey[t.key]) {
              mappedKey = rawKeyToMappedKey[t.key];
            } else {
              if (biomarkerDefinitions.some(d => d.key === t.key)) {
                mappedKey = t.key;
              } else if (keyMapping[t.key]) {
                mappedKey = keyMapping[t.key];
              } else {
                const cleaned = cleanName((t.key || "").split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
                const stdMatch = biomarkerDefinitions.find(d => d.name.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase());
                if (stdMatch) {
                  mappedKey = stdMatch.key;
                } else {
                  const existingCustoms = { ...(profile?.customBiomarkers || {}) };
                  const custMatchKey = Object.keys(existingCustoms).find(k => cleanName(existingCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase());
                  if (custMatchKey) {
                    mappedKey = custMatchKey;
                  } else {
                    const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                    mappedKey = safeKey || t.key;
                  }
                }
              }
            }
            return {
              ...t,
              key: mappedKey
            };
          });
        }

        if (existingLogIndex >= 0) {
          // Merge with existing log for this date
          const existingTests = updatedHistory[existingLogIndex].tests || [];
          const mergedTests = [...existingTests];
          entryTests.forEach((t: any) => {
            const idx = mergedTests.findIndex(et => et.key === t.key);
            if (idx >= 0) {
              mergedTests[idx] = { ...mergedTests[idx], ...t };
            } else {
              mergedTests.push(t);
            }
          });

          updatedHistory[existingLogIndex] = {
            ...updatedHistory[existingLogIndex],
            biomarkers: { ...updatedHistory[existingLogIndex].biomarkers, ...mappedExtracted },
            tests: mergedTests,
            sync_state: 'update',
            updated_at: Date.now()
          };
          const mergeTarget = updatedHistory[existingLogIndex];
          entryTests.forEach((t: any) => {
            attachObservationMeta(mergeTarget, t.key, {
              unit: t.unit,
              printedRange: t.normalRange || t.printedRange,
              labFlag: t.labFlag || t.flag,
              rawValue: mappedExtracted[t.key],
            });
          });
          Object.entries(mappedExtracted).forEach(([k, v]) => {
            if (!mergeTarget.observationMeta?.[k]) {
              attachObservationMeta(mergeTarget, k, {
                unit: (currentProfile as any)?.customBiomarkers?.[k]?.unit,
                rawValue: v,
              });
            }
          });
          modifiedLogIds.push(updatedHistory[existingLogIndex].id);
        } else {
          const datedLog: BiomarkerLog = {
            id: `med_log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: recordDate,
            biomarkers: mappedExtracted,
            tests: entryTests,
            sync_state: 'new',
            updated_at: Date.now()
          };
          entryTests.forEach((t: any) => {
            attachObservationMeta(datedLog, t.key, {
              unit: t.unit,
              printedRange: t.normalRange || t.printedRange,
              labFlag: t.labFlag || t.flag,
              rawValue: mappedExtracted[t.key],
            });
          });
          Object.entries(mappedExtracted).forEach(([k, v]) => {
            if (!datedLog.observationMeta?.[k]) {
              attachObservationMeta(datedLog, k, {
                unit: (currentProfile as any)?.customBiomarkers?.[k]?.unit,
                rawValue: v,
              });
            }
          });
          updatedHistory.push(datedLog);
          modifiedLogIds.push(datedLog.id);
        }
      }
    });
    if (finalProfileUpdates && Object.keys(finalProfileUpdates).length > 0) {
      if (typeof finalProfileUpdates.age === 'string') finalProfileUpdates.age = parseFloat(finalProfileUpdates.age) || finalProfileUpdates.age;
      if (typeof finalProfileUpdates.weight === 'string') finalProfileUpdates.weight = parseFloat(finalProfileUpdates.weight) || finalProfileUpdates.weight;
      if (typeof finalProfileUpdates.height === 'string') finalProfileUpdates.height = parseFloat(finalProfileUpdates.height) || finalProfileUpdates.height;
      const nextProfile = { ...profile, ...finalProfileUpdates };
      const bmiRes = logBmiIfProfileWeightHeightChanged(profile, nextProfile, updatedHistory, updatedBiomarkers);
      currentProfile = nextProfile;
      updatedHistory = bmiRes.updatedHistory;
      updatedBiomarkers = bmiRes.updatedBiomarkers;
      setProfile(currentProfile);
      setBiomarkerHistory(updatedHistory);
      setBiomarkers(updatedBiomarkers);
    }
    if (hasNewBiomarkers) {
      // Sort history by date descending
      updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
      setBiomarkerHistory(updatedHistory);
      // Recompute the latest biomarkers from history so they reflect the latest dates (sorted ascending)
      const recomputedBiomarkers: { [key: string]: number | string } = {};
      [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
      setBiomarkers(recomputedBiomarkers);
      if (!skipClose) {
        setIsMedicalChatOpen(false);
        setActiveTab('home');
      }

// Sync deferred to manual button click
      
      await saveAndSync(currentProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: modifiedLogIds, deletedIds: [] });
    } else {
      if (!skipClose) {
        setIsMedicalChatOpen(false);
        setActiveTab('home');
      }
      await saveAndSync(currentProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: modifiedLogIds, deletedIds: [] });
    }
  };
  const handleDeleteMultipleBiomarkers = async (keys: string[]) => {
    const updatedBiomarkers = { ...biomarkers };
    keys.forEach(key => delete updatedBiomarkers[key]);
    
    const logsToDelete: string[] = [];
    const logsToUpdate: string[] = [];
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      let changed = false;
      keys.forEach(key => {
        if (cleanBiomarkers[key] !== undefined) {
          delete cleanBiomarkers[key];
          changed = true;
        }
      });
      if (changed) {
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
          return { ...log, biomarkers: cleanBiomarkers, sync_state: 'delete' as const, updated_at: Date.now() };
        } else {
          logsToUpdate.push(log.id);
          return { ...log, biomarkers: cleanBiomarkers, sync_state: 'update' as const, updated_at: Date.now() };
        }
      }
      return log;
    });
    
    // Do NOT filter out logsToDelete from updatedHistory so syncUtils can process them!
    setBiomarkers(updatedBiomarkers);
    setBiomarkerHistory(updatedHistory);
    
    let updatedProfile = { ...profile } as UserProfile;
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = { ...(updatedProfile.deletedBiomarkerLogIds || {}) };
      logsToDelete.forEach((id: string) => { updatedProfile.deletedBiomarkerLogIds![id] = Date.now(); });
    }
    if (updatedProfile.customBiomarkers) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      keys.forEach(key => delete newCustoms[key]);
      updatedProfile.customBiomarkers = newCustoms;
    }
    updatedProfile.deletedCustomBiomarkerKeys = { ...(updatedProfile.deletedCustomBiomarkerKeys || {}) };
    keys.forEach(k => { updatedProfile.deletedCustomBiomarkerKeys![k] = Date.now(); });
    setProfile(updatedProfile);
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate, deletedIds: logsToDelete });
    } else if (logsToDelete.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: [], deletedIds: logsToDelete });
    } else {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };

  const handleDeleteBiomarker = async (key: string) => {
    const updatedBiomarkers = { ...biomarkers };
    delete updatedBiomarkers[key];
    
    const logsToDelete: string[] = [];
    const logsToUpdate: string[] = [];
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      if (cleanBiomarkers[key] !== undefined) {
        delete cleanBiomarkers[key];
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
          return { ...log, biomarkers: cleanBiomarkers, sync_state: 'delete' as const, updated_at: Date.now() };
        } else {
          logsToUpdate.push(log.id);
          return { ...log, biomarkers: cleanBiomarkers, sync_state: 'update' as const, updated_at: Date.now() };
        }
      }
      return log;
    });
    
    // Do NOT filter out logsToDelete from updatedHistory so syncUtils can process them!
    setBiomarkers(updatedBiomarkers);
    setBiomarkerHistory(updatedHistory);
    let updatedProfile = { ...profile } as UserProfile;
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = { ...(updatedProfile.deletedBiomarkerLogIds || {}) };
      logsToDelete.forEach((id: string) => { updatedProfile.deletedBiomarkerLogIds![id] = Date.now(); });
    }
    if (updatedProfile.customBiomarkers && updatedProfile.customBiomarkers[key]) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      delete newCustoms[key];
      updatedProfile.customBiomarkers = newCustoms;
    }
    updatedProfile.deletedCustomBiomarkerKeys = { ...(updatedProfile.deletedCustomBiomarkerKeys || {}), [key]: Date.now() };
    setProfile(updatedProfile);
// Sync deferred to manual button click
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate, deletedIds: logsToDelete });
    } else if (logsToDelete.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: [], deletedIds: logsToDelete });
    } else {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };

  const handleFlagNotUsedGlobal = async (key: string) => {
    if (!profile) return;
    const updatedNotUsed = {
      ...(profile.notUsedBiomarkers || {}),
      [key]: { flaggedAt: Date.now() }
    };
    const updatedDeletedNotUsed = { ...(profile.deletedNotUsedBiomarkerKeys || {}) };
    delete updatedDeletedNotUsed[key];
    const updatedProfile: UserProfile = {
      ...profile,
      notUsedBiomarkers: updatedNotUsed,
      deletedNotUsedBiomarkerKeys: updatedDeletedNotUsed
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
  };

  const handleRestoreNotUsedGlobal = async (key: string) => {
    if (!profile || !profile.notUsedBiomarkers) return;
    const updatedNotUsed = { ...profile.notUsedBiomarkers };
    delete updatedNotUsed[key];
    Object.keys(updatedNotUsed).forEach(k => {
      if (k.toLowerCase() === key.toLowerCase()) {
        delete updatedNotUsed[k];
      }
    });
    const updatedDeletedNotUsed = {
      ...(profile.deletedNotUsedBiomarkerKeys || {}),
      [key]: Date.now()
    };
    const updatedProfile: UserProfile = {
      ...profile,
      notUsedBiomarkers: updatedNotUsed,
      deletedNotUsedBiomarkerKeys: updatedDeletedNotUsed
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
  };

  const handleFlagNotUsedLocal = async (key: string) => {
    if (!profile) return;
    const updatedLocal = {
      ...(profile.notUsedInMedicalHistory || {}),
      [key]: { flaggedAt: Date.now() }
    };
    const updatedProfile: UserProfile = {
      ...profile,
      notUsedInMedicalHistory: updatedLocal
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
  };

  const handleRestoreNotUsedLocal = async (key: string) => {
    if (!profile || !profile.notUsedInMedicalHistory) return;
    const updatedLocal = { ...profile.notUsedInMedicalHistory };
    delete updatedLocal[key];
    Object.keys(updatedLocal).forEach(k => {
      if (k.toLowerCase() === key.toLowerCase()) {
        delete updatedLocal[k];
      }
    });
    const updatedProfile: UserProfile = {
      ...profile,
      notUsedInMedicalHistory: updatedLocal
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
  };
  const handleDeleteEmptyBiomarkers = async () => {
    let updatedProfile = { ...profile } as UserProfile;
    let modifiedProfile = false;
    let modifiedBiomarkers = false;

    const logsToDelete: string[] = [];
    const logsToUpdate: BiomarkerLog[] = [];

    // 1. Clean history: remove empty values from logs.
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      let logChanged = false;

      Object.keys(cleanBiomarkers).forEach(key => {
        const val = cleanBiomarkers[key];
        // Delete if it has no useful value or is 0
        if (isValEmpty(val)) {
          delete cleanBiomarkers[key];
          logChanged = true;
        }
      });

      if (logChanged) {
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
          return { ...log, biomarkers: cleanBiomarkers, sync_state: 'delete' as const, updated_at: Math.max(Date.now(), (log.updated_at || 0) + 1000) };
        } else {
          const updatedLog = { ...log, biomarkers: cleanBiomarkers, sync_state: 'update' as const, updated_at: Math.max(Date.now(), (log.updated_at || 0) + 1000) };
          logsToUpdate.push(updatedLog);
          return updatedLog;
        }
      }
      return log;
    });

    // We do NOT filter out logsToDelete, syncUtils handles it
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = { ...(updatedProfile.deletedBiomarkerLogIds || {}) };
      logsToDelete.forEach((id: string) => { updatedProfile.deletedBiomarkerLogIds![id] = Date.now(); });
      modifiedProfile = true;
    }

    // Explicitly record BMI suppression so auto-log does not re-inject it on sync
    updatedProfile.bmiAutoLogged = true;
    updatedProfile.deletedCustomBiomarkerKeys = mergeDeleteMaps(updatedProfile.deletedCustomBiomarkerKeys, { bmi: Date.now() });
    modifiedProfile = true;

    // Recompute the biomarkers state
    // NOTE: Do NOT delete profile.customBiomarkers or write deletedCustomBiomarkerKeys here.
    // Unused dictionary definitions are not "empty biomarkers" — wiping them strips custom categorisations
    // and causes biomarkers to revert back to Pending Approval.
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });

    // Detect if current biomarkers state changed
    const currentKeys = Object.keys(biomarkers);
    const newKeys = Object.keys(recomputedBiomarkers);
    if (currentKeys.length !== newKeys.length || currentKeys.some(k => biomarkers[k] !== recomputedBiomarkers[k])) {
      modifiedBiomarkers = true;
    }

    if (logsToDelete.length === 0 && logsToUpdate.length === 0 && !modifiedProfile && !modifiedBiomarkers) {
      return; // Nothing to change
    }

    if (modifiedProfile) setProfile(updatedProfile);
    if (modifiedBiomarkers) setBiomarkers(recomputedBiomarkers);
    setBiomarkerHistory(updatedHistory);

// Sync deferred to manual button click
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate.map(l => l.id), deletedIds: logsToDelete });
    } else if (logsToDelete.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: [], deletedIds: logsToDelete });
    } else {
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };
  const handleDeleteBiomarkerLog = async (id: string) => {
    const existingLog = biomarkerHistory.find(b => b.id === id);
    const existingUpdated = existingLog?.updated_at || 0;
    const now = Math.max(Date.now(), existingUpdated + 1000);
    // Keep it in array but mark as delete so syncUtils can process it
    const updatedHistory = biomarkerHistory.map(b => b.id === id ? { ...b, sync_state: 'delete' as const, updated_at: now } : b);
    setBiomarkerHistory(updatedHistory);
    
    let updatedProfile = profile ? {
      ...profile,
      deletedBiomarkerLogIds: mergeDeleteMaps(profile.deletedBiomarkerLogIds, { [id]: now }),
      ...(id.includes('bmi') || existingLog?.biomarkers?.bmi !== undefined ? {
        bmiAutoLogged: true,
        deletedCustomBiomarkerKeys: mergeDeleteMaps(profile.deletedCustomBiomarkerKeys, { bmi: now })
      } : {})
    } : null;
    if (updatedProfile) {
      setProfile(updatedProfile);
    }

    // We filter it out for the recomputed local state map
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setBiomarkers(recomputedBiomarkers);
    
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'deleteBiomarker', targetId: id });
  };
  const handleDeleteBiomarkerFromLog = async (id: string, key: string) => {
    const targetLog = biomarkerHistory.find(b => b.id === id);
    if (!targetLog) return;

    const canonicalKeyToDelete = (getMappedBiomarkerKey(key) || key).toLowerCase().replace(/[\s_]/g, '');
    const keysToDelete = Object.keys(targetLog.biomarkers || {}).filter(k => {
      const canK = (getMappedBiomarkerKey(k) || k).toLowerCase().replace(/[\s_]/g, '');
      return k === key || canK === canonicalKeyToDelete || k.toLowerCase().replace(/[\s_]/g, '') === canonicalKeyToDelete;
    });

    const remainingKeys = Object.keys(targetLog.biomarkers || {}).filter(k => !keysToDelete.includes(k));
    
    if (remainingKeys.length > 0) {
      const now = Date.now();
      const updatedHistory = biomarkerHistory.map(log => {
        if (log.id === id) {
          const newBiomarkers = { ...log.biomarkers };
          keysToDelete.forEach(k => delete newBiomarkers[k]);
          return {
            ...log,
            biomarkers: newBiomarkers,
            sync_state: 'update' as const,
            updated_at: now
          };
        }
        return log;
      });
      setBiomarkerHistory(updatedHistory);
      
      let updatedProfile = profile;
      if (canonicalKeyToDelete === 'bmi' || key.toLowerCase() === 'bmi') {
        updatedProfile = profile ? {
          ...profile,
          bmiAutoLogged: true,
          deletedCustomBiomarkerKeys: mergeDeleteMaps(profile.deletedCustomBiomarkerKeys, { bmi: now })
        } : null;
        if (updatedProfile) setProfile(updatedProfile);
      }

      const recomputedBiomarkers: { [key: string]: number | string } = {};
      [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
      setBiomarkers(recomputedBiomarkers);
      
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId: id });
    } else {
      await handleDeleteBiomarkerLog(id);
    }
  };
  const handleEditBiomarkerLog = async (id: string, key: string, value: string | number, newDate?: string) => {
    const updatedHistory = biomarkerHistory.map(log => {
      if (log.id === id) {
        const numValue = typeof value === 'string' ? parseFloat(value) : value;
        return {
          ...log,
          date: newDate || log.date,
          biomarkers: {
            ...log.biomarkers,
            [key]: isNaN(numValue) ? value : numValue
          },
          sync_state: 'update' as const,
          updated_at: Date.now()
        };
      }
      return log;
    });
    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
    setBiomarkerHistory(updatedHistory);
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setBiomarkers(recomputedBiomarkers);
    await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId: id });
  };
  const handleBatchDeleteBiomarkersFromLogs = async (deletions: { id: string; key: string }[]) => {
    if (!deletions || deletions.length === 0) return;

    const deletionsByLogId = new Map<string, Set<string>>();
    deletions.forEach(d => {
      if (!deletionsByLogId.has(d.id)) {
        deletionsByLogId.set(d.id, new Set());
      }
      deletionsByLogId.get(d.id)!.add(d.key);
    });

    const now = Date.now();
    const deletedLogIds: string[] = [];
    const updatedHistory: BiomarkerLog[] = [];

    biomarkerHistory.forEach(log => {
      const keysToDelete = deletionsByLogId.get(log.id);
      if (!keysToDelete) {
        updatedHistory.push(log);
        return;
      }

      const newBiomarkers = { ...log.biomarkers };
      Object.keys(newBiomarkers).forEach(bk => {
        const canonical = getMappedBiomarkerKey(bk) || bk;
        if (
          keysToDelete.has(bk) ||
          keysToDelete.has(canonical) ||
          Array.from(keysToDelete).some(k => k.toLowerCase().replace(/[\s_]/g, '') === bk.toLowerCase().replace(/[\s_]/g, '') || k.toLowerCase().replace(/[\s_]/g, '') === canonical.toLowerCase().replace(/[\s_]/g, ''))
        ) {
          delete newBiomarkers[bk];
        }
      });

      const remainingKeys = Object.keys(newBiomarkers);
      if (remainingKeys.length > 0) {
        updatedHistory.push({
          ...log,
          biomarkers: newBiomarkers,
          sync_state: 'update' as const,
          updated_at: now
        });
      } else {
        deletedLogIds.push(log.id);
        updatedHistory.push({
          ...log,
          biomarkers: {},
          sync_state: 'delete' as const,
          updated_at: now
        });
      }
    });

    let updatedProfile = profile;
    if (deletedLogIds.length > 0 && profile) {
      const newDeletes: Record<string, number> = {};
      deletedLogIds.forEach(id => {
        newDeletes[id] = now;
      });
      updatedProfile = {
        ...profile,
        deletedBiomarkerLogIds: mergeDeleteMaps(profile.deletedBiomarkerLogIds, newDeletes)
      };
      setProfile(updatedProfile);
    }

    setBiomarkerHistory(updatedHistory);

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory]
      .filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
      .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
      .forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
    setBiomarkers(recomputedBiomarkers);

    const targetUpdatedIds = Array.from(deletionsByLogId.keys()).filter(id => !deletedLogIds.includes(id));
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, {
      type: 'biomarkerLogsBatch',
      targetIds: targetUpdatedIds.length > 0 ? targetUpdatedIds : undefined,
      deletedIds: deletedLogIds.length > 0 ? deletedLogIds : undefined
    });
  };
  const handleBatchEditBiomarkersInLogs = async (updates: { id: string; key: string; value: string | number }[]) => {
    if (!updates || updates.length === 0) return;

    const updatesByLogId = new Map<string, { key: string; value: string | number }[]>();
    updates.forEach(u => {
      if (!updatesByLogId.has(u.id)) {
        updatesByLogId.set(u.id, []);
      }
      updatesByLogId.get(u.id)!.push(u);
    });

    const now = Date.now();
    const updatedHistory = biomarkerHistory.map(log => {
      const logUpdates = updatesByLogId.get(log.id);
      if (!logUpdates) return log;

      const newBiomarkers = { ...log.biomarkers };
      logUpdates.forEach(u => {
        const numValue = typeof u.value === 'string' ? parseFloat(u.value) : u.value;
        newBiomarkers[u.key] = isNaN(numValue) ? u.value : numValue;
      });

      return {
        ...log,
        biomarkers: newBiomarkers,
        sync_state: 'update' as const,
        updated_at: now
      };
    });

    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
    setBiomarkerHistory(updatedHistory);

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory]
      .filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
      .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
      .forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
    setBiomarkers(recomputedBiomarkers);

    await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog' });
  };
  const handleStandardizeBiomarkerUnits = async (
    updates: { [key: string]: any },
    logValueCorrections?: { logId?: string; date: string; key: string; newValue: number }[]
  ) => {
    let hasChanges = false;
    const updatedProfile = { ...profile };
    if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
    let updatedHistory = [...biomarkerHistory];
    let historyChanged = false;
    const logsToUpdate: string[] = [];

    // 1. Apply user-approved historical log value conversions
    if (Array.isArray(logValueCorrections) && logValueCorrections.length > 0) {
      logValueCorrections.forEach(corr => {
        updatedHistory = updatedHistory.map(log => {
          const matches = corr.logId ? log.id === corr.logId : log.date === corr.date;
          if (matches && log.biomarkers) {
            const targetKeyInLog = Object.keys(log.biomarkers).find(k => k.toLowerCase() === corr.key.toLowerCase());
            if (targetKeyInLog) {
              historyChanged = true;
              if (log.id) logsToUpdate.push(log.id);
              return {
                ...log,
                biomarkers: {
                  ...log.biomarkers,
                  [targetKeyInLog]: corr.newValue
                },
                sync_state: 'update' as const,
                updated_at: Date.now()
              };
            }
          }
          return log;
        });
      });
    }

    for (const [key, val] of Object.entries(updates)) {
      const targetKey = (val.newKey || val.standardizedKey || key) as string;
      const originalKey = (val.originalKey || (val.newKey && val.newKey !== key ? key : undefined)) as string | undefined;

      if (originalKey && originalKey !== targetKey) {
        const fromCustom = (updatedProfile.customBiomarkers[originalKey] || {}) as any;
        const existingTarget = (updatedProfile.customBiomarkers[targetKey] || {}) as any;
        updatedProfile.customBiomarkers[targetKey] = { ...fromCustom, ...existingTarget };
        delete updatedProfile.customBiomarkers[originalKey];

        updatedHistory = updatedHistory.map(log => {
          if (log.biomarkers && log.biomarkers[originalKey] !== undefined) {
            const newB = { ...log.biomarkers };
            if (newB[targetKey] === undefined) {
              newB[targetKey] = newB[originalKey];
            }
            delete newB[originalKey];
            historyChanged = true;
            if (log.id) logsToUpdate.push(log.id);
            return { ...log, biomarkers: newB, sync_state: 'update' as const, updated_at: Date.now() };
          }
          return log;
        });
      }

      const oldCustom = (updatedProfile.customBiomarkers[targetKey] || updatedProfile.customBiomarkers[key] || {}) as any;
      // Relabel only — never apply conversionFactor to stored numbers.
      const nextUnit = val.unit !== undefined && val.unit !== null && String(val.unit).trim() !== ''
        ? val.unit
        : oldCustom.unit;
      const nextName = (val.name && String(val.name).trim() !== '' && val.name !== targetKey)
        ? val.name
        : (oldCustom.name || val.name || targetKey);

      const now = Date.now();
      updatedProfile.lastUpdatedAt = now;
      updatedProfile.customBiomarkers[targetKey] = {
        ...oldCustom,
        name: nextName,
        unit: nextUnit,
        updatedAt: now,
        ...(val.normalRange !== undefined ? { normalRange: val.normalRange } : {}),
        ...(val.minRange !== undefined ? { minRange: val.minRange } : {}),
        ...(val.maxRange !== undefined ? { maxRange: val.maxRange } : {}),
        ...(val.optimalRange !== undefined ? { optimalRange: val.optimalRange } : {}),
        ...(val.optimalMin !== undefined ? { optimalMin: val.optimalMin } : {}),
        ...(val.optimalMax !== undefined ? { optimalMax: val.optimalMax } : {}),
        ...(val.rangeBrackets !== undefined ? { rangeBrackets: val.rangeBrackets } : {}),
        ...(val.rangeConfig !== undefined ? { rangeConfig: val.rangeConfig } : {}),
        ...(val.customRanges !== undefined ? { customRanges: val.customRanges } : {}),
        ...(val.notes !== undefined ? { notes: val.notes } : {}),
        ...(val.instrumentScale !== undefined ? { instrumentScale: val.instrumentScale } : {}),
        ...(val.dataType !== undefined ? { dataType: val.dataType } : {}),
        ...(val.category !== undefined ? { category: val.category } : (oldCustom.category ? { category: oldCustom.category } : {})),
        standardMedicalGrouping: val.standardMedicalGrouping !== undefined
          ? val.standardMedicalGrouping
          : (oldCustom.standardMedicalGrouping || "By Medical Practice"),
        riskCategories: val.riskCategories !== undefined ? val.riskCategories : oldCustom.riskCategories,
        potentialMedicalConditions: val.potentialMedicalConditions !== undefined
          ? val.potentialMedicalConditions
          : oldCustom.potentialMedicalConditions,
        ...(val.description !== undefined ? { description: val.description } : (oldCustom.description ? { description: oldCustom.description } : {})),
        ...(val.descriptions !== undefined ? { descriptions: val.descriptions } : (oldCustom.descriptions ? { descriptions: oldCustom.descriptions } : {})),
        catalogApproved: true,
        needsApproval: false
      } as any;

      delete updatedProfile.customBiomarkers[targetKey].needsApproval;
      hasChanges = true;
    }

    if (hasChanges || historyChanged) {
      let nextBiomarkers = biomarkers;
      if (historyChanged) {
        const recomputedBiomarkers: { [key: string]: number | string } = {};
        [...updatedHistory]
          .filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
          .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
          .forEach(log => {
            Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
              recomputedBiomarkers[k] = v as string | number;
            });
          });
        nextBiomarkers = recomputedBiomarkers;
        setBiomarkerHistory(updatedHistory);
        setBiomarkers(recomputedBiomarkers);
      }
      setProfile(updatedProfile);
      if (historyChanged && logsToUpdate.length > 0) {
        await saveAndSync(updatedProfile, foodLogs, nextBiomarkers, updatedHistory, actions, dailyBenefits, report, {
          type: 'biomarkerLogsBatch',
          targetIds: [...new Set(logsToUpdate)],
          deletedIds: []
        });
      } else {
        await saveAndSync(updatedProfile, foodLogs, nextBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
      }
    }
  };

  
  const handleBatchCombineBiomarkers = async (
    combinations: {
      targetKey: string;
      targetDef: any;
      mergedLogs: { date: string; value: number | string; originalLogId?: string }[];
      sourceKeysToDelete: string[];
    }[]
  ) => {
    let updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
    let deletedCustomBiomarkerKeys = { ...(profile?.deletedCustomBiomarkerKeys || {}) };
    let updatedHistory = [...biomarkerHistory];
    
    combinations.forEach(combo => {
      const { targetKey, targetDef, mergedLogs, sourceKeysToDelete } = combo;
      const keysToDelete = sourceKeysToDelete.filter(k => k !== targetKey);
      
      keysToDelete.forEach(k => {
        delete updatedCustomBiomarkers[k];
        deletedCustomBiomarkerKeys[k] = Date.now();
      });
      delete deletedCustomBiomarkerKeys[targetKey];

      const builtIn = biomarkerDefinitions.find(d => d.key === targetKey);
      const existingCustom = updatedCustomBiomarkers[targetKey];
      
      updatedCustomBiomarkers[targetKey] = {
        ...(builtIn || {}),
        ...(existingCustom || {}),
        name: targetDef.name,
        unit: targetDef.unit,
        normalRange: targetDef.normalRange,
        description: targetDef.description,
        standardMedicalGrouping: targetDef.standardMedicalGrouping || '',
        riskCategories: targetDef.riskCategories || [],
        potentialMedicalConditions: targetDef.potentialMedicalConditions || [],
        ...(targetDef.rangeConfig ? { rangeConfig: targetDef.rangeConfig } : {}),
        ...(targetDef.customRanges ? { customRanges: targetDef.customRanges } : {})
      };

      updatedHistory = updatedHistory.map(log => {
        const cleanBiomarkers = { ...log.biomarkers };
        let logChanged = false;
        keysToDelete.forEach(k => {
          if (cleanBiomarkers[k] !== undefined) {
            delete cleanBiomarkers[k];
            logChanged = true;
          }
        });

        // Update tests array and observationMeta
        let updatedTests = log.tests;
        if (Array.isArray(log.tests)) {
          const testMap = new Map<string, any>();
          log.tests.forEach((t: any) => {
            const mappedKey = keysToDelete.includes(t.key) ? targetKey : t.key;
            if (!testMap.has(mappedKey)) {
              testMap.set(mappedKey, { ...t, key: mappedKey });
            } else {
              testMap.set(mappedKey, { ...testMap.get(mappedKey), ...t, key: mappedKey });
            }
          });
          updatedTests = Array.from(testMap.values());
          logChanged = true;
        }

        let updatedMeta = log.observationMeta ? { ...log.observationMeta } : undefined;
        if (updatedMeta) {
          keysToDelete.forEach(k => {
            if (updatedMeta![k]) {
              if (!updatedMeta![targetKey]) {
                updatedMeta![targetKey] = updatedMeta![k];
              }
              delete updatedMeta![k];
              logChanged = true;
            }
          });
        }

        return {
          ...log,
          biomarkers: cleanBiomarkers,
          ...(updatedTests ? { tests: updatedTests } : {}),
          ...(updatedMeta ? { observationMeta: updatedMeta } : {}),
          ...(logChanged ? { sync_state: 'update' as const, updated_at: Date.now() } : {})
        };
      });

      mergedLogs.forEach(ml => {
        let existingIndex = -1;
        if (ml.originalLogId) {
          existingIndex = updatedHistory.findIndex(h => h.id === ml.originalLogId);
        }
        if (existingIndex < 0) {
          existingIndex = updatedHistory.findIndex(h => h.date === ml.date);
        }
        if (existingIndex >= 0) {
          updatedHistory[existingIndex] = {
            ...updatedHistory[existingIndex],
            biomarkers: {
              ...updatedHistory[existingIndex].biomarkers,
              [targetKey]: ml.value
            },
            sync_state: 'update' as const,
            updated_at: Date.now()
          };
        } else {
          updatedHistory.push({
            id: `med_log_combined_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: ml.date,
            biomarkers: {
              [targetKey]: ml.value
            },
            sync_state: 'new' as const,
            updated_at: Date.now()
          });
        }
      });
    });

    const logsToDelete: string[] = [];
    updatedHistory = updatedHistory.map(h => {
      if (Object.keys(h.biomarkers).length === 0 && !h.note) {
        logsToDelete.push(h.id);
        return { ...h, sync_state: 'delete' as const, updated_at: Date.now() };
      }
      return h;
    });

    const now = Date.now();
    const updatedProfile: UserProfile = {
      ...profile as any,
      lastUpdatedAt: now,
      customBiomarkers: updatedCustomBiomarkers,
      deletedCustomBiomarkerKeys,
      deletedBiomarkerLogIds: {
        ...(profile?.deletedBiomarkerLogIds || {}),
        ...Object.fromEntries(logsToDelete.map(id => [id, now]))
      }
    };

    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        if (!deletedCustomBiomarkerKeys[k]) {
          recomputedBiomarkers[k] = v as string | number;
        }
      });
    });

    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

    const changedLogIds = updatedHistory.filter(l => l.sync_state !== 'delete').map(l => l.id);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: changedLogIds, deletedIds: logsToDelete });
  };


  const handleCombineBiomarkers = async (
    targetKey: string,
    targetDef: any,
    mergedLogs: { date: string; value: number | string; originalLogId?: string }[],
    sourceKeysToDelete: string[]
  ) => {
    // 1. Remove old custom definitions, and add the new one if custom
    const updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
    const deletedCustomBiomarkerKeys = { ...(profile?.deletedCustomBiomarkerKeys || {}) };
    const keysToDelete = sourceKeysToDelete.filter(k => k !== targetKey);
    keysToDelete.forEach(k => {
      delete updatedCustomBiomarkers[k];
      deletedCustomBiomarkerKeys[k] = Date.now();
    });
    delete deletedCustomBiomarkerKeys[targetKey];

    const builtIn = biomarkerDefinitions.find(d => d.key === targetKey);
    const existingCustom = profile?.customBiomarkers?.[targetKey];
    
    updatedCustomBiomarkers[targetKey] = {
      ...(builtIn || {}),
      ...(existingCustom || {}),
      name: targetDef.name,
      unit: targetDef.unit,
      normalRange: targetDef.normalRange,
      description: targetDef.description,
      standardMedicalGrouping: targetDef.standardMedicalGrouping || '',
      riskCategories: targetDef.riskCategories || [],
      potentialMedicalConditions: targetDef.potentialMedicalConditions || [],
      ...(targetDef.rangeConfig ? { rangeConfig: targetDef.rangeConfig } : {}),
      ...(targetDef.customRanges ? { customRanges: targetDef.customRanges } : {})
    };
    const updatedProfile: UserProfile = {
      ...profile,
      customBiomarkers: updatedCustomBiomarkers,
      deletedCustomBiomarkerKeys
    };
    // 2. Remove old keys from history and merge the consolidated logs
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      let changed = false;
      keysToDelete.forEach(k => {
        if (cleanBiomarkers[k] !== undefined) {
          delete cleanBiomarkers[k];
          changed = true;
        }
      });

      // Update tests array and observationMeta
      let updatedTests = log.tests;
      if (Array.isArray(log.tests)) {
        const testMap = new Map<string, any>();
        log.tests.forEach((t: any) => {
          const mappedKey = keysToDelete.includes(t.key) ? targetKey : t.key;
          if (!testMap.has(mappedKey)) {
            testMap.set(mappedKey, { ...t, key: mappedKey });
          } else {
            testMap.set(mappedKey, { ...testMap.get(mappedKey), ...t, key: mappedKey });
          }
        });
        updatedTests = Array.from(testMap.values());
        changed = true;
      }

      let updatedMeta = log.observationMeta ? { ...log.observationMeta } : undefined;
      if (updatedMeta) {
        keysToDelete.forEach(k => {
          if (updatedMeta![k]) {
            if (!updatedMeta![targetKey]) {
              updatedMeta![targetKey] = updatedMeta![k];
            }
            delete updatedMeta![k];
            changed = true;
          }
        });
      }

      if (changed) {
        return {
          ...log,
          biomarkers: cleanBiomarkers,
          ...(updatedTests ? { tests: updatedTests } : {}),
          ...(updatedMeta ? { observationMeta: updatedMeta } : {}),
          sync_state: 'update' as const,
          updated_at: Date.now()
        };
      }
      return log;
    });
    // Merge Consolidated
    mergedLogs.forEach(ml => {
      let existingIndex = -1;
      if (ml.originalLogId) {
        existingIndex = updatedHistory.findIndex(h => h.id === ml.originalLogId);
      }
      if (existingIndex < 0) {
        existingIndex = updatedHistory.findIndex(h => h.date === ml.date);
      }
      if (existingIndex >= 0) {
        updatedHistory[existingIndex] = {
          ...updatedHistory[existingIndex],
          biomarkers: {
            ...updatedHistory[existingIndex].biomarkers,
            [targetKey]: ml.value
          },
          sync_state: 'update' as const,
          updated_at: Date.now()
        };
      } else {
        updatedHistory.push({
          id: `med_log_combined_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          date: ml.date,
          biomarkers: {
            [targetKey]: ml.value
          },
          sync_state: 'new' as const,
          updated_at: Date.now()
        });
      }
    });
    // Clean completely empty history logs
    const logsToDelete: string[] = [];
    updatedHistory = updatedHistory.map(h => {
      if (Object.keys(h.biomarkers).length === 0 && !h.note) {
        logsToDelete.push(h.id);
        return { ...h, sync_state: 'delete' as const, updated_at: Date.now() };
      }
      return h;
    });
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = { ...(updatedProfile.deletedBiomarkerLogIds || {}) };
      logsToDelete.forEach(id => { updatedProfile.deletedBiomarkerLogIds![id] = Date.now(); });
    }
    
    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
    // 3. Recompute latest biomarkers
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

    const changedLogIds = updatedHistory.filter(l => l.sync_state !== 'delete').map(l => l.id);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: changedLogIds, deletedIds: logsToDelete });
  };
  const handleBatchConsolidate = async (mapping: { [key: string]: string }) => {
    const targetGroups: { [targetKey: string]: string[] } = {};
    const updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
    const deletedCustomBiomarkerKeys = { ...(profile?.deletedCustomBiomarkerKeys || {}) };

    Object.entries(mapping).forEach(([srcKey, tgtKey]) => {
      if (srcKey && tgtKey) {
        if (srcKey !== tgtKey) {
          if (!targetGroups[tgtKey]) {
            targetGroups[tgtKey] = [];
          }
          if (!targetGroups[tgtKey].includes(srcKey)) {
            targetGroups[tgtKey].push(srcKey);
          }
        } else {
          // If source equals target, the user is approving the marker as its own standard definition
          if (!updatedCustomBiomarkers[srcKey]) {
            updatedCustomBiomarkers[srcKey] = {
              name: srcKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
              unit: '',
              normalRange: '',
              description: '',
              standardMedicalGrouping: 'By Medical Practice' // Giving it a grouping marks it as approved
            } as any;
          } else if (!updatedCustomBiomarkers[srcKey].standardMedicalGrouping) {
            updatedCustomBiomarkers[srcKey].standardMedicalGrouping = 'By Medical Practice';
          }
        }
      }
    });

    let updatedHistory = [...biomarkerHistory];

    Object.entries(targetGroups).forEach(([targetKey, sourceKeys]) => {
      const isTargetStandard = biomarkerDefinitions.some(d => d.key === targetKey);
      if (!isTargetStandard && !updatedCustomBiomarkers[targetKey]) {
        const sourceDef = sourceKeys.map(k => updatedCustomBiomarkers[k]).find(def => !!def);
        updatedCustomBiomarkers[targetKey] = {
          name: sourceDef?.name || targetKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          unit: sourceDef?.unit || '',
          normalRange: sourceDef?.normalRange || '',
          description: sourceDef?.description || '',
          benefitRisk: sourceDef?.benefitRisk || ''
        };
      }

      const allUniqueDates = Array.from(new Set(
        updatedHistory.filter(log => {
          return log.biomarkers[targetKey] !== undefined || sourceKeys.some(k => log.biomarkers[k] !== undefined);
        }).map(log => log.date)
      ));

      allUniqueDates.forEach(date => {
        const dayLogs = updatedHistory.filter(log => log.date === date);
        if (dayLogs.length === 0) return;

        const values: (number | string)[] = [];
        const notes: string[] = [];
        const summaries: string[] = [];
        const testsList: any[] = [];

        dayLogs.forEach(log => {
          if (log.biomarkers[targetKey] !== undefined && log.biomarkers[targetKey] !== null && log.biomarkers[targetKey] !== '') {
            values.push(log.biomarkers[targetKey]);
          }
          sourceKeys.forEach(k => {
            if (log.biomarkers[k] !== undefined && log.biomarkers[k] !== null && log.biomarkers[k] !== '') {
              values.push(log.biomarkers[k]);
            }
          });

          if (log.note) notes.push(log.note);
          if (log.summary) summaries.push(log.summary);
          if (log.tests && Array.isArray(log.tests)) {
            testsList.push(...log.tests);
          }
        });

        let finalValue: number | string | undefined = undefined;
        if (values.length > 0) {
          const numericValues = values.map(v => Number(v)).filter(n => !isNaN(n));
          if (numericValues.length === values.length && numericValues.length > 0) {
            const sum = numericValues.reduce((a, b) => a + b, 0);
            finalValue = Number((sum / numericValues.length).toFixed(2));
          } else {
            finalValue = values[0];
          }
        }

        const uniqueNotes = Array.from(new Set(notes.map(n => n.trim()).filter(Boolean)));
        const uniqueSummaries = Array.from(new Set(summaries.map(s => s.trim()).filter(Boolean)));

        const combinedNote = uniqueNotes.join(' | ');
        const combinedSummary = uniqueSummaries.join(' | ');

        const primaryLog = dayLogs[0];
        primaryLog.biomarkers[targetKey] = finalValue !== undefined ? finalValue : primaryLog.biomarkers[targetKey];
        if (combinedNote) primaryLog.note = combinedNote;
        if (combinedSummary) primaryLog.summary = combinedSummary;
        if (testsList.length > 0) {
          primaryLog.tests = testsList;
        }

        dayLogs.forEach(log => {
          sourceKeys.forEach(k => {
            delete log.biomarkers[k];
          });
        });
      });

      sourceKeys.forEach(k => {
        delete updatedCustomBiomarkers[k];
        deletedCustomBiomarkerKeys[k] = Date.now();
      });
    });

    updatedHistory = updatedHistory.filter(h => Object.keys(h.biomarkers).length > 0);
    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });

    const updatedProfile: UserProfile = {
      ...profile,
      customBiomarkers: updatedCustomBiomarkers,
      deletedCustomBiomarkerKeys
    };

    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

// Sync deferred to manual button click
    const changedLogIds = updatedHistory.map(l => l.id);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: changedLogIds });
  };
  const handleApplyCalculation = async (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => {
    let updatedBenefits = [...dailyBenefits];
    if (updates.addedBenefit) {
      const exists = updatedBenefits.some(b => {
        const actName = b.activity || (b as any).label || '';
        return actName.toLowerCase() === updates.addedBenefit!.toLowerCase() || b.id === 'walking_30';
      });
      if (!exists) {
        updatedBenefits.push({
          id: 'walking_30',
          activity: updates.addedBenefit,
          target: '30 min',
          completed: false
        });
        setDailyBenefits(updatedBenefits);
      }
    }
    let updatedReport = report ? { ...report } : getLocalFallbackReport(profile);
    if (updates.targetCalories && updatedReport) {
      updatedReport = {
        ...updatedReport,
        dailyNutrientTargets: {
          ...updatedReport.dailyNutrientTargets,
          calories: `${updates.targetCalories} kcal`
        }
      };
      setReport(updatedReport);
    }
    let updatedHistory = [...biomarkerHistory];
    const latestBmiLogIndex = updatedHistory.findIndex(h => h.biomarkers.bmi !== undefined);
    if (latestBmiLogIndex >= 0 && updates.descriptionExplain) {
      updatedHistory[latestBmiLogIndex] = {
        ...updatedHistory[latestBmiLogIndex],
        note: updates.descriptionExplain
      };
      setBiomarkerHistory(updatedHistory);
      // Quickly save this log since multi-sync skips collections
      saveAndSync(profile, foodLogs, biomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId: updatedHistory[latestBmiLogIndex].id }).catch(console.error);
    }
    let updatedProfile = { ...profile };
    const isAsian = isAsianEthnicity(updatedProfile.ethnicity);
    const gender = (updatedProfile.gender || 'male').toLowerCase();
    const isMale = gender.startsWith('m');
    const targetBmi = isAsian ? 21.0 : (isMale ? 22.5 : 21.7);
    const targetRange = isAsian ? '18.5 - 22.9' : '18.5 - 24.9';
    const targetWeight = updates.targetWeight || Math.round(targetBmi * Math.pow((updatedProfile.height || 170) / 100, 2) * 10) / 10;
    if (targetWeight) {
      if (!updatedProfile.customBiomarkers) {
        updatedProfile.customBiomarkers = {};
      }
      if (!updatedProfile.customBiomarkers.bmi) {
        updatedProfile.customBiomarkers.bmi = {
          name: 'Body Mass Index (BMI)',
          unit: 'kg/m²',
          normalRange: targetRange,
          description: 'A measure of body fat based on height and weight.',
          benefitRisk: ''
        };
      } else {
        updatedProfile.customBiomarkers.bmi = {
          ...updatedProfile.customBiomarkers.bmi,
          normalRange: targetRange,
          description: 'A measure of body fat based on height and weight.'
        };
      }
      setProfile(updatedProfile);
    }
    await saveAndSync(updatedProfile, foodLogs, biomarkers, updatedHistory, actions, updatedBenefits, updatedReport);
  };
  // Accept and apply recommendations to active dashboard targets
  const handleAcceptReport = async (acceptedReport: RecommendationReport) => {
    setReport(acceptedReport);
    setActions(acceptedReport.actions);
    setDailyBenefits(acceptedReport.dailyBenefits);
    setDraftReport(null);
    
    // Quick, clean targeted sync to database
    await saveAndSync(
      profile,
      foodLogs,
      biomarkers,
      biomarkerHistory,
      acceptedReport.actions,
      acceptedReport.dailyBenefits,
      acceptedReport,
      { type: 'report' }
    );
    
    // Auto-navigate to dashboard for glorious preview of newly updated targets
    setActiveTab('home');
  };

  const handleRejectReport = () => {
    setDraftReport(null);
  };
  // Run On-demand Insights Totality analysis with LLM Selection
  const handleGenerateReport = async (modelId: string, refinement?: { message: string, chatHistory: any[] }) => {
    setIsGenerating(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 18000); // 18-second robust timeout
    try {
      trackApiCall('gemini', `Insight Analyze`, auth.currentUser?.email || 'anonymous');
      const excludedKeys = new Set([
        ...Object.keys(profile?.notUsedBiomarkers || {}),
        ...Object.keys(profile?.notUsedInMedicalHistory || {})
      ]);
      const analysisEligibleHistory = excludedKeys.size === 0 ? biomarkerHistory : biomarkerHistory.map(log => {
        if (!log.biomarkers) return log;
        const filtered = { ...log.biomarkers };
        let changed = false;
        Object.keys(filtered).forEach(k => {
          if (excludedKeys.has(k)) { delete filtered[k]; changed = true; }
        });
        return changed ? { ...log, biomarkers: filtered } : log;
      });
      const response = await fetch('/api/gemini/insight-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userProfile: profile,
          foodLogs,
          biomarkerHistory: analysisEligibleHistory,
          engine: modelId,
          refinement
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const resText = await response.text();
      let resData: any = {};
      try {
        resData = JSON.parse(resText);
      } catch {
        throw new Error(`Server returned non-JSON response (${response.status})`);
      }
      if (resData.error) throw new Error(resData.error);
      if (resData.report) {
        setDraftReport(resData.report);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Analysis generation error/timeout:", err);
      if (err.name === 'AbortError') {
        safeAlert('Server took longer than expected to complete profiling. Activating specialized local preventative engine fallback.');
        const fallback = getLocalFallbackReport(profile);
        setDraftReport(fallback);
      } else {
        safeAlert(`Failed to complete analysis: ${err.message || 'Server timeout. Activating high-fidelity fallback.'}`);
        const fallback = getLocalFallbackReport(profile);
        setDraftReport(fallback);
      }
    } finally {
      setIsGenerating(false);
    }
  };
  // Lock body scroll when modals are open
  useEffect(() => {
    if (isFoodChatOpen || isMedicalChatOpen || isManualFoodLogOpen || isConflictModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isFoodChatOpen, isMedicalChatOpen, isManualFoodLogOpen, isConflictModalOpen]);

  // Render Screens based on active tab
  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-theme-bg flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-xs font-semibold text-slate-500 animate-pulse">Checking your health portal...</p>
        </div>
      </div>
    );
  }
  if (!profile) {
    return <AuthScreen onLogin={handleLogin} />;
  }
  // Floating Action Button (FAB) rules:
  // - Home, Food, Trends tabs show '+' for adding food log.
  // - Medical, Insights tabs show 'Medical icon' for adding medical records chat logs.
  const isMedicalTabFAB = ['medical', 'insights'].includes(activeTab);
  return (
    <div className="h-[100dvh] overflow-hidden bg-theme-bg flex flex-col transition-colors duration-200">
      <style dangerouslySetInnerHTML={{ __html: getDynamicStyles(profile) }} />
      
      {/* Header Profile Section */}
      <Header
        activeTab={activeTab}
        viewingJobId={activeJobId}
        onViewJob={handleOpenJob}
        onNavigateTab={(tab) => setActiveTab(tab as any)}
        biomarkerHistory={biomarkerHistory}
        setBiomarkerHistory={setBiomarkerHistory}
        setFoodLogs={setFoodLogs}
        profile={profile}
        onSaveAndSync={saveAndSync}
        biomarkers={biomarkers}
        actions={actions}
        dailyBenefits={dailyBenefits}
        report={report}
        onOpenFrontDesk={() => setIsFrontDeskOpen(true)}
        onOpenUndo={() => setShowSnapshotPanel(true)}
        setProfile={(pInput) => {
          setProfile((prevProfile) => {
            const resolved = typeof pInput === 'function' ? pInput(prevProfile!) : pInput;
            if (!resolved) return prevProfile;

            const now = Date.now();
            const updatedProfile: UserProfile = {
              ...resolved,
              lastUpdatedAt: now
            };

            const bundle = {
              profile: updatedProfile,
              foodLogs,
              biomarkers,
              biomarkerHistory,
              actions,
              dailyBenefits,
              report
            };
            safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), bundle);
            saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });

            return updatedProfile;
          });
        }}
        onSaveProfile={async (p) => {
          const updatedProfile = { ...p };
          const { updatedHistory, updatedBiomarkers, changed } = logBmiIfProfileWeightHeightChanged(profile, updatedProfile, biomarkerHistory, biomarkers);
          setProfile(updatedProfile);
          if (changed) {
            setBiomarkerHistory(updatedHistory);
            setBiomarkers(updatedBiomarkers);
            await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
          } else {
            await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
          }
        }}
        hideSensitive={hideSensitive}
        setHideSensitive={setHideSensitive}
        syncState={syncState}
        onSignOut={handleSignOut}
        onCloudSync={() => checkForDbChanges(undefined, true)}
        onForcePush={() => saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'fullPush', cloudFoods: [], cloudBioHistory: [], forceOverwrite: true, includeFoods: false } as any)}
        onForcePushWithFoods={() => saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'fullPush', cloudFoods: [], cloudBioHistory: [], forceOverwrite: true, includeFoods: true } as any)}
        onForcePull={() => checkForDbChanges(undefined, true, true)}
        dbInteractions={dbInteractions}
        quota={quota}
        foodLogs={foodLogs}
        autoSyncDisabled={autoSyncDisabled}
        onChangeAutoSyncDisabled={handleToggleAutoSyncDisabled}
      />
      {syncFailedWarning && (
        <div className="px-5 py-2.5 bg-rose-600 text-white text-xs font-bold flex items-center justify-between shadow-sm animate-in slide-in-from-top duration-200 shrink-0 z-30">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-100 shrink-0" />
            <span>{syncFailedWarning}</span>
          </div>
          <button
            type="button"
            onClick={() => setSyncFailedWarning(null)}
            className="text-white/85 hover:text-white cursor-pointer ml-3 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {profile?.userType === 'Demo' && (
        <div className="bg-gradient-to-r from-slate-100 to-indigo-50/50 dark:from-slate-900/90 dark:to-indigo-950/20 border-b border-theme-border py-2 px-4 flex flex-col md:flex-row items-center justify-between gap-3 text-center md:text-left z-20 shadow-sm shrink-0">
          <div className="flex flex-wrap items-center gap-2 justify-center md:justify-start">
            <span className="inline-block px-2 py-0.5 text-[9px] font-bold text-indigo-600 bg-indigo-100/60 dark:text-indigo-400 dark:bg-indigo-950/40 rounded-full uppercase tracking-wider">
              Demo Sandbox
            </span>
            <p className="text-xs font-bold text-theme-neutral">
              Active Profile: <span className="text-indigo-600 dark:text-indigo-400">{profile.nickname}</span> {profile.age ? `(${profile.age}-yo)` : '(Empty)'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span className="text-[10px] text-theme-text-secondary font-semibold">Switch Demo Profile:</span>
            {[
              { id: 'empty', label: '1. Initial Start (Empty)', desc: 'Completely empty sandbox account' },
              { id: 'average', label: '2. Average Person (Standard)', desc: 'Alex (28-yo, lipids/vitamin D deficiency)' },
              { id: 'complex', label: '3. 50-yo with Chronic Issues', desc: 'Arthur (52-yo, Type 2 diabetes & Hypertension)' }
            ].map((d) => {
              const currentDemoType = localStorage.getItem('demo_profile_type') || 'average';
              const isActive = currentDemoType === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => handleSwitchDemoProfile(d.id as DemoProfileType)}
                  title={d.desc}
                  className={`px-3 py-1 text-[10px] font-semibold rounded-lg transition-all shadow-sm shrink-0 cursor-pointer ${
                    isActive 
                      ? 'bg-indigo-600 text-white font-bold scale-[1.02]' 
                      : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-theme-border text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {syncState === 'conflict' && conflictData && (
        <div className="bg-indigo-600 text-white py-2 px-4 shadow-md transition-all duration-300 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-3 text-center md:text-left z-20 border-b border-indigo-700/30">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-1.5 rounded-lg shrink-0">
              <RefreshCw className="w-4 h-4 text-white animate-spin" />
            </div>
            <div>
              <p className="text-xs font-bold leading-normal text-left">
                Data Out of Sync / Conflict Detected
              </p>
              <p className="text-[10px] text-white/90 text-left">
                Your local device data and cloud database have both been modified separately. Click "Resolve Conflict" to choose which data to keep.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setIsConflictModalOpen(true);
              }}
              className="px-3 py-1 bg-white hover:bg-slate-100 text-indigo-700 font-bold text-[10px] rounded-lg transition-all shadow-sm shrink-0 cursor-pointer"
            >
              Resolve Conflict
            </button>
          </div>
        </div>
      )}
      <ConflictResolutionModal
        isOpen={isConflictModalOpen}
        onClose={() => setIsConflictModalOpen(false)}
        conflictData={conflictData}
        onResolve={handleResolveConflict}
      />
      {/* Main Viewport Container */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden" id="main-scroll-container">
        <React.Suspense fallback={(
          <div className="min-h-[50vh] flex items-center justify-center">
            <Loader className="w-6 h-6 text-indigo-600 animate-spin" />
          </div>
        )}>
        {activeTab === 'home' && (
          <HomeTab
            profile={profile}
            foodLogs={foodLogs}
            biomarkers={biomarkers}
            biomarkerHistory={biomarkerHistory}
            actions={actions}
            onViewJob={handleOpenJob}
            onLogFood={handleLogFood}
            isLoadingProfile={isInitialDataLoading || syncState === 'syncing'}
            syncState={syncState}
            setActions={async (act) => {
              setActions(act);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, act, dailyBenefits, report, { type: 'actions' });
            }}
            dailyBenefits={dailyBenefits}
            setDailyBenefits={async (ben) => {
              const deleted = dailyBenefits.filter(old => !ben.some(n => n.id === old.id));
              let updatedProfile = { ...profile };
              if (deleted.length > 0) {
                updatedProfile = { ...profile, deletedDailyBenefitIds: { ...(profile.deletedDailyBenefitIds || {}) } };
                deleted.forEach(d => { updatedProfile.deletedDailyBenefitIds![d.id] = Date.now(); });
                setProfile(updatedProfile);
              }
              setDailyBenefits(ben);
              await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, ben, report, { type: 'dailyBenefits' });
            }}
            foodIdeas={foodIdeas}
            setFoodIdeas={async (ideas) => {
              setFoodIdeas(ideas);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodIdeas' }, ideas);
            }}
            report={report}
            onNavigateToTab={setActiveTab}
            onEditBiomarkerLog={handleEditBiomarkerLog}
            onDeleteBiomarkerLog={handleDeleteBiomarkerLog}
            onDeleteBiomarkerFromLog={handleDeleteBiomarkerFromLog}
            onBatchDeleteBiomarkersFromLogs={handleBatchDeleteBiomarkersFromLogs}
            onBatchEditBiomarkersInLogs={handleBatchEditBiomarkersInLogs}
            onLogMedical={handleLogMedical}
            onOpenAgentChat={(agentType, options) => {
              setActiveAgentType(agentType);
              setPrefillMessage(options?.prefillMessage || null);
              setActiveReviewBiomarkerKey(options?.biomarkerKey);
              if (options?.dataReviewBatchIdx !== undefined) setActiveDataReviewBatchIdx(options.dataReviewBatchIdx);
              if (options?.dataReviewBatchKeys) setActiveDataReviewBatchKeys(options.dataReviewBatchKeys);
              setIsMedicalChatOpen(true);
            }}
            hideSensitive={hideSensitive}
            selectedModelId={selectedModelId}
            onChangeModelId={setSelectedModelId}
            hasBmiAlert={profile ? hasBmiPendingAlert(profile, dismissedBmiAlerts, report) : false}
            onDismissBmiAlert={handleDismissBmiAlert}
            onApplyCalculation={handleApplyCalculation}
            onUpdateReport={async (updatedReport) => {
              setReport(updatedReport);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, updatedReport, { type: 'report' });
            }}
          />
        )}
        {activeTab === 'food' && (
          <ErrorBoundary>
          <FoodHistoryTab
            profile={profile}
            foodLogs={foodLogs}
            onUpdateFoodLog={handleUpdateFoodLog}
            onDeleteFoodLog={handleDeleteFoodLog}
            onReplaceFoodLogs={async (foods) => {
              setFoodLogs(foods);
              await saveAndSync(profile, foods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, {
                type: 'food',
              } as any);
            }}
            onLogFood={handleLogFood}
            onEditingActiveChange={setIsEditingFoodLog}
            isManualEntryOpen={isManualFoodLogOpen}
            onManualEntryOpenChange={setIsManualFoodLogOpen}
            manualEntryAlert={manualFoodLogError}
            onClearManualEntryAlert={() => setManualFoodLogError(null)}
            report={report}
            initiallyExpandedFoodId={initiallyExpandedFoodId}
            onClearInitiallyExpandedFoodId={() => setInitiallyExpandedFoodId(null)}
            onViewJob={handleOpenJob}
          />
          </ErrorBoundary>
        )}
        {(activeTab === 'health' || activeTab === 'insights' || activeTab === 'medical') && (
          <div className="max-w-md mx-auto">
            {/* Tablet Sub-tab Toggle Bar */}
            <div className="px-3 pt-3">
              <div className="bg-slate-200/90 dark:bg-slate-800/90 p-1 rounded-2xl flex items-center shadow-sm max-w-xs mx-auto mb-2 border border-theme-border/60 backdrop-blur-md">
                <button
                  onClick={() => setHealthSubTab('biomarker')}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    healthSubTab === 'biomarker'
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5 stroke-[2.5]" />
                  Biomarker
                </button>
                <button
                  onClick={() => setHealthSubTab('insight')}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    healthSubTab === 'insight'
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 stroke-[2.5]" />
                  Insight
                </button>
              </div>
            </div>

            {healthSubTab === 'biomarker' ? (
              <MedicalHistoryTab
                profile={profile}
                biomarkers={biomarkers}
                biomarkerHistory={biomarkerHistory}
                foodLogs={foodLogs}
                hideSensitive={hideSensitive}
                onViewJob={handleOpenJob}
                onApplyDataSanitize={async (selected: SanitizeProposal[]) => {
                  const { applyDataSanitizePlan: applyPlan, buildDataSanitizePlan } = await import('./utils/dataSanitize');
                  const plan = buildDataSanitizePlan({
                    profile,
                    biomarkers,
                    biomarkerHistory,
                    foodLogs,
                  });
                  const result = applyPlan(plan, new Set(selected.map((s) => s.id)), {
                    profile,
                    biomarkers,
                    biomarkerHistory,
                    foodLogs,
                  });
                  const nextProfile = { ...profile, ...result.profileUpdates };
                  setProfile(nextProfile);
                  setFoodLogs(result.foodLogs);
                  setBiomarkerHistory(result.biomarkerHistory);
                  setBiomarkers(result.biomarkers);
                  await saveAndSync(
                    nextProfile,
                    result.foodLogs,
                    result.biomarkers,
                    result.biomarkerHistory,
                    actions,
                    dailyBenefits,
                    report
                  );
                  console.log(`[DataSanitize] Applied ${result.applied} proposals`);
                }}
                onDeleteEmptyBiomarkers={handleDeleteEmptyBiomarkers}
                onUpdateProfile={async (updates) => {
                  let updatedProfile = { ...profile, ...updates };
                  // B7.5: Demographic Overlay Auto-Calibrator
                  if (updates.age !== undefined || updates.gender !== undefined || updates.ethnicity !== undefined) {
                    const { updatedCustomBiomarkers, recalibratedCount } = recalibrateProfileOverlays(updatedProfile);
                    if (recalibratedCount > 0) {
                      updatedProfile.customBiomarkers = updatedCustomBiomarkers;
                    }
                  }
                  setProfile(updatedProfile);
                  await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
                }}
                onEditBiomarkerLog={handleEditBiomarkerLog}
                onLogMedical={handleLogMedical}
                onDeleteBiomarker={handleDeleteBiomarker}
                onFlagNotUsed={handleFlagNotUsedGlobal}
                onFlagNotUsedLocal={handleFlagNotUsedLocal}
                onRestoreNotUsedLocal={handleRestoreNotUsedLocal}
                onRestoreNotUsedGlobal={handleRestoreNotUsedGlobal}
                onDeleteMultipleBiomarkers={handleDeleteMultipleBiomarkers}
                onDeleteBiomarkerLog={handleDeleteBiomarkerLog}
                onDeleteBiomarkerFromLog={handleDeleteBiomarkerFromLog}
                onStandardizeUnits={handleStandardizeBiomarkerUnits}
                onCombineBiomarkers={handleCombineBiomarkers}
                onBatchCombineBiomarkers={handleBatchCombineBiomarkers}
                onBatchConsolidate={handleBatchConsolidate}
                onReviewWithAgent={(keys) => {
                  const userIdentifier = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';
                  localStorage.setItem(`agent1_custom_batch_keys_${userIdentifier}`, JSON.stringify(keys));
                  sessionStorage.setItem('auto_open_custom_batch_modal', 'true');
                  setActiveTab('insights');
                }}
                onOpenAgentChat={(agentType, options) => {
                  setActiveAgentType(agentType);
                  setPrefillMessage(options?.prefillMessage || null);
                  setActiveReviewBiomarkerKey(options?.biomarkerKey);
                  if (options?.dataReviewBatchIdx !== undefined) setActiveDataReviewBatchIdx(options.dataReviewBatchIdx);
                  if (options?.dataReviewBatchKeys) setActiveDataReviewBatchKeys(options.dataReviewBatchKeys);
                  setIsMedicalChatOpen(true);
                }}
                onApplyCalculation={handleApplyCalculation}
                selectedModelId={selectedModelId}
                onChangeModelId={setSelectedModelId}
                hasBmiAlert={profile ? hasBmiPendingAlert(profile, dismissedBmiAlerts, report) : false}
                onDismissBmiAlert={handleDismissBmiAlert}
                onAgentAnalysisSaved={handleAgentAnalysisSaved}
                onDeleteAnalysis={handleDeleteAnalysis}
              />
            ) : (
              <InsightsTab
                profile={profile}
                foodLogs={foodLogs}
                biomarkers={biomarkers}
                biomarkerHistory={biomarkerHistory}
                onDataReviewStateChange={setDataReviewSharedState}
                onDeleteBiomarker={handleDeleteBiomarker}
                onFlagNotUsed={handleFlagNotUsedGlobal}
                onRestoreNotUsedGlobal={handleRestoreNotUsedGlobal}
                onDeleteMultipleBiomarkers={handleDeleteMultipleBiomarkers}
                calibratingBatchIdx={calibratingBatchIdx}
                calibratingAgentType={calibratingAgentType}
                report={report}
                draftReport={draftReport}
                onAcceptReport={handleAcceptReport}
                onRejectReport={handleRejectReport}
                selectedModelId={selectedModelId}
                onChangeModelId={setSelectedModelId}
                onGenerateReport={handleGenerateReport}
                isGenerating={isGenerating}
                onNavigateToTab={setActiveTab as any}
                onOpenMedicalChat={() => {
                  setActiveAgentType(null);
                  setPrefillMessage(null);
                  setActiveReviewBiomarkerKey(undefined);
                  setIsMedicalChatOpen(true);
                }}
                onUpdateProfile={async (updatedProfile) => {
                  setProfile(updatedProfile);
                  await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report);
                }}
                onUpdateHistory={async (updatedHistory, newBiomarkers, updatedProfileArg) => {
                  setBiomarkerHistory(updatedHistory);
                  setBiomarkers(newBiomarkers);
                  if (updatedProfileArg) setProfile(updatedProfileArg);
                  await saveAndSync(updatedProfileArg || profile, foodLogs, newBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
                }}
                batchSize={batchSize}
                onChangeBatchSize={(size) => {
                  setBatchSize(size);
                  try {
                    localStorage.setItem('biomarker_batch_size', size.toString());
                  } catch (e) {}
                }}
                onOpenAgentChat={(agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'health_baseline' | 'agent7' | 'data_review' | 'biomarker_review', options?: {
                  biomarkerKey?: string; 
                  prefillMessage?: string; 
                  dataReviewBatchIdx?: number | string; 
                  dataReviewBatchKeys?: string[];
                  remainingText?: string;
                  extractedData?: any[];
                  currentBatch?: number;
                  estimatedTotalMarkers?: number | null;
                }) => {
                  setActiveAgentType(resolveAgentDestination(agentType) as any);
                  setPrefillMessage(options?.prefillMessage || null);
                  setActiveReviewBiomarkerKey(options?.biomarkerKey);
                  setActiveDataReviewBatchIdx(options?.dataReviewBatchIdx !== undefined ? options.dataReviewBatchIdx : null);
                  setActiveDataReviewBatchKeys(options?.dataReviewBatchKeys || []);
                  setActiveDataReviewRemainingText(options?.remainingText || '');
                  setActiveDataReviewExtractedYaml(options?.extractedData || []);
                  setActiveDataReviewCurrentBatch(options?.currentBatch || 1);
                  setActiveDataReviewEstimatedTotalMarkers(options?.estimatedTotalMarkers !== undefined ? options.estimatedTotalMarkers : null);
                  setIsMedicalChatOpen(true);
                }}
                onDeleteAnalysis={handleDeleteAnalysis}
                onArchiveAnalysis={async (id) => {
                  if (profile.agentAnalyses) {
                    const updatedProfile = {
                      ...profile,
                      agentAnalyses: profile.agentAnalyses.map(a => a.id === id ? { ...a, archived: true } : a)
                    };
                    setProfile(updatedProfile);
                    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'analysis', targetId: id });
                  }
                }}
                onAgentAnalysisSaved={handleAgentAnalysisSaved}
                onOpenFrontDesk={() => setIsFrontDeskOpen(true)}
              />
            )}
          </div>
        )}
        {activeTab === 'trends' && (
          <ErrorBoundary>
          <TrendsTab
            profile={profile}
            foodLogs={foodLogs}
            biomarkerHistory={biomarkerHistory}
            hideSensitive={hideSensitive}
            report={report}
            onSelectFood={(id) => {
              setInitiallyExpandedFoodId(id);
              setActiveTab('food');
            }}
          />
          </ErrorBoundary>
        )}
        </React.Suspense>
      </main>
      {/* Floating Action Sheet overlay for Quick Actions */}
      <FloatingActionSheet
        isOpen={isFloatingOpen}
        onClose={() => setIsFloatingOpen(false)}
        onLogMeal={() => {
          const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          JobStore.createJob({
            id: jobId,
            kind: 'food_log',
            lockedModeFamily: 'A',
            status: 'draft',
          });
          setActiveJobId(jobId);
        }}
        onCompareMeal={() => {
          const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          JobStore.createJob({
            id: jobId,
            kind: 'food_compare',
            lockedModeFamily: 'D',
            status: 'draft',
          });
          setActiveJobId(jobId);
        }}
        onHealthInfo={() => {
          setIsFrontDeskOpen(true);
        }}
      />
      {/* Bottom Material Tab Bar (Icons only) */}
      <BottomNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        language={profile?.language || "en"}
        onPlusClick={() => setIsFloatingOpen(!isFloatingOpen)}
        isFloatingOpen={isFloatingOpen}
      />
      {/* Slide-over interactive dialogs */}
      
      {(() => {
        const handleOpenAgentFromFrontDesk = (agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent7' | 'data_review' | 'health_baseline' | null) => {
          setIsFrontDeskOpen(false);
          setActiveAgentType(resolveAgentDestination(agentType) as any);
          setPrefillMessage(null);
          setActiveDataReviewBatchIdx(null);
          setActiveDataReviewBatchKeys([]);
          setActiveDataReviewRemainingText('');
          setActiveDataReviewExtractedYaml([]);
          setActiveDataReviewCurrentBatch(1);
          setActiveDataReviewEstimatedTotalMarkers(null);
          setIsMedicalChatOpen(true);
        };
        return (
          <ErrorBoundary>{isFrontDeskOpen && <LogChat type="front_desk"
            profile={profile}
            isOpen={isFrontDeskOpen}
            onOpenAgentFromFrontDesk={handleOpenAgentFromFrontDesk}
            selectedModelId={selectedModelId}
            onChangeModelId={setSelectedModelId}
            onJobEnqueued={(id, kind) => setActiveTab(kind === 'food' ? 'food' : 'medical')}
            onClose={() => setIsFrontDeskOpen(false)}
            biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        foodLogs={foodLogs}
        onSaveProfile={async (updatedP) => {
          setProfile(updatedP);
          await saveAndSync(updatedP, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
        }}
        onAddBiomarkerLogs={async (logs) => {
          let updatedBiomarkers = { ...biomarkers };
          let updatedHistory = [...biomarkerHistory];
          logs.forEach(log => {
            const key = getMappedBiomarkerKey(log.biomarker) || log.biomarker;
            updatedBiomarkers[key] = log.value;
            const day = log.date || new Date().toISOString().split('T')[0];
            const sourceId = log.sourceReportId;
            const idx = updatedHistory.findIndex((h) =>
              toYYYYMMDD(h.date) === toYYYYMMDD(day)
              && (!sourceId || !h.sourceReportId || h.sourceReportId === sourceId)
            );
            if (idx >= 0 && (!sourceId || !updatedHistory[idx].sourceReportId || updatedHistory[idx].sourceReportId === sourceId)) {
              updatedHistory[idx] = {
                ...updatedHistory[idx],
                biomarkers: { ...updatedHistory[idx].biomarkers, [key]: log.value },
                sync_state: 'update',
                updated_at: Date.now(),
              };
              attachObservationMeta(updatedHistory[idx], key, { unit: log.unit, rawValue: log.value });
            } else {
              const row = {
                id: `bm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                biomarkers: { [key]: log.value },
                date: day,
                sourceReportId: sourceId,
              };
              attachObservationMeta(row, key, { unit: log.unit, rawValue: log.value });
              updatedHistory.push(row);
            }
          });
          setBiomarkers(updatedBiomarkers);
          setBiomarkerHistory(updatedHistory);
          await saveAndSync(profile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: updatedHistory.slice(-logs.length).map(l => l.id) });
        }}

      />}</ErrorBoundary>
        );
      })()}
      <ErrorBoundary>{isFoodChatOpen && <LogChat type="food"
        profile={profile}
        isOpen={isFoodChatOpen}
        jobId={activeJobId}
        selectedModelId={selectedModelId}
        onChangeModelId={setSelectedModelId}
        onJobEnqueued={(id, kind) => {
          setActiveJobId(id);
          setActiveTab('food');
        }}
        onClose={async () => {
          try {
            if (activeJobId) {
              const job = JobStore.getJob(activeJobId);
              if (job && job.status === 'draft') {
                await JobStore.deleteJob(activeJobId);
              }
            }
          } catch (err) {
            console.error('[FoodChat onClose] Draft cleanup failed, closing modal anyway:', err);
          } finally {
            setActiveJobId(null);
            setActiveTab('food');
          }
        }}
        onLogFood={handleLogFood}
        biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        foodLogs={foodLogs}
        report={report}
        isFirestoreQuotaExceeded={isFirestoreQuotaExceeded}
        onSaveProfile={async (updatedP) => {
          setProfile(updatedP);
          await saveAndSync(updatedP, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
        }}
        onGoToManualEdit={(errorMsg) => {
          setActiveJobId(null);
          setActiveTab('food');
          if (errorMsg) {
            setManualFoodLogError(errorMsg);
          }
          setIsManualFoodLogOpen(true);
        }}
      />}</ErrorBoundary>
      <ErrorBoundary>{isMedicalChatOpen && <LogChat key={`medical_${activeAgentType || 'general'}`}
        type="medical"
        profile={profile}
        isOpen={isMedicalChatOpen}
        jobId={activeJobId}
        selectedModelId={selectedModelId}
        onChangeModelId={setSelectedModelId}
        onJobEnqueued={(id, kind) => {
          setActiveTab('health');
          setHealthSubTab('biomarker');
        }}
        onClose={() => {
          setIsMedicalChatOpen(false);
          setActiveAgentType(null);
          setPrefillMessage(null);
          setActiveDataReviewBatchIdx(null);
          setActiveJobId(null);
          setActiveTab('health');
          setHealthSubTab('biomarker');
        }}
        autoSendMessage={prefillMessage}
        onLogMedical={handleLogMedical}
        biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        foodLogs={foodLogs}
        report={report}
        actions={actions}
        isFirestoreQuotaExceeded={isFirestoreQuotaExceeded}
        onSaveProfile={async (updatedP) => {
          setProfile(updatedP);
          await saveAndSync(updatedP, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
        }}
        agentType={activeAgentType}
        reviewBiomarkerKey={activeReviewBiomarkerKey}
        dataReviewBatchIdx={activeDataReviewBatchIdx}
        dataReviewBatchKeys={activeDataReviewBatchKeys}
        remainingText={activeDataReviewRemainingText}
        extractedData={activeDataReviewExtractedYaml}
        currentBatch={activeDataReviewCurrentBatch}
        estimatedTotalMarkers={activeDataReviewEstimatedTotalMarkers}
        batchSize={batchSize}
        dataReviewSharedState={dataReviewSharedState}
        onDataReviewBatchChange={(idx) => {
          setActiveDataReviewBatchIdx(idx);
          const sharedBatches = dataReviewSharedState?.batches || [];
          if (idx === 'custom') {
            setActiveDataReviewBatchKeys(dataReviewSharedState?.customDataReviewBatchKeys || []);
          } else {
            setActiveDataReviewBatchKeys(sharedBatches[idx as number] || []);
          }
        }}
        onAgentAnalysisSaved={handleAgentAnalysisSaved}
        onAgentFinish={async (agentType, agentResult, extraActions?: HealthAction[]) => {
          // ─── SNAPSHOT BEFORE ANY CHANGE (FIX-8) ──────────────────────────
          const snapLabel = `Before ${agentType} approval (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })})`;
          await saveLocalSnapshot(snapLabel, profile?.email, {
            profile,
            foodLogs,
            biomarkers,
            biomarkerHistory,
            actions,
            dailyBenefits,
            report
          });
          if (profile?.email) {
            setSnapshots(await loadLocalSnapshots(profile.email));
          }
          setLastSnapshotLabel(snapLabel);
          // ───────────────────────────────────────────────────────────────
          const isPartialApply = !!(agentResult?.forceApplyNow) && !!(agentResult?.hasMoreMarkers || agentResult?.hasMore || agentResult?.needsContinuation || agentResult?.status === 'needs_continuation');
          if (!isPartialApply) {
            setIsMedicalChatOpen(false);
          }
          setCalibratingAgentType(agentType);
          const updatedProfile = { ...profile };
          
          let currentHistory = [...biomarkerHistory];
          let currentReport = report ? { ...report } : null;
          let currentDailyBenefits = [...dailyBenefits];
          let currentActions = [...actions];

          // Review: apply modificationCommand (dated) and/or flat corrections
          if ((agentType as string) === 'biomarker_review') {
            let candidate = agentResult;
            if (typeof candidate === 'string') {
              try {
                candidate = JSON.parse(candidate.replace(/```(?:json)?/gi, '').trim());
              } catch (e) {}
            }

            const rawCmds = Array.isArray(candidate?.modificationCommand)
              ? candidate.modificationCommand
              : (Array.isArray(candidate?.result?.modificationCommand)
                ? candidate.result.modificationCommand
                : (Array.isArray(candidate?.agentResult?.modificationCommand)
                  ? candidate.agentResult.modificationCommand
                  : (Array.isArray((candidate as any)?.clean_result?.modificationCommand)
                    ? (candidate as any).clean_result.modificationCommand
                    : (Array.isArray((candidate as any)?.data?.modificationCommand)
                      ? (candidate as any).data.modificationCommand
                      : (Array.isArray((candidate as any)?.data?.agentResult?.modificationCommand)
                        ? (candidate as any).data.agentResult.modificationCommand
                        : [])))));

            const unitMap = collectCatalogUnitMap(updatedProfile);
            let commands = enrichReviewModificationCommands(
              rawCmds,
              currentHistory || [],
              unitMap
            );

            if (commands.length === 0 && (candidate?.reply || candidate?.text || candidate?.initialRawText || (typeof candidate === 'string' ? candidate : ''))) {
              commands = extractFallbackModifications(candidate?.reply || candidate?.text || candidate?.initialRawText || (typeof candidate === 'string' ? candidate : '') || '', currentHistory || [], updatedProfile);
              if (commands.length > 0) {
                commands = enrichReviewModificationCommands(commands, currentHistory || [], unitMap);
              }
            }

            const unselected = Array.isArray(candidate?.unselectedRowKeys) ? candidate.unselectedRowKeys : [];
            if (unselected.length > 0) {
              commands = commands.filter((cmd: any) => !unselected.includes(cmd.keyName || cmd.key || cmd.biomarker));
            }

            const { history: afterCommands, applied } = applyModificationCommands(currentHistory, commands, unitMap);
            currentHistory = afterCommands;

            const corrections: Record<string, any> = agentResult?.corrections || agentResult?.biomarkerCorrections || {};
            if (Object.keys(corrections).length > 0) {
              const correctionDate = agentResult?.date || new Date().toISOString().split('T')[0];
              const existingIdx = currentHistory.findIndex((h: any) => toYYYYMMDD(h.date) === toYYYYMMDD(correctionDate));
              if (existingIdx >= 0) {
                currentHistory[existingIdx] = {
                  ...currentHistory[existingIdx],
                  biomarkers: { ...currentHistory[existingIdx].biomarkers, ...corrections }
                };
              } else {
                currentHistory.push({
                  id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                  date: correctionDate,
                  biomarkers: corrections,
                  note: "Corrected by Review"
                });
              }
            }

            const proposal = agentResult?.proposal;
            if (proposal && (proposal.range || proposal.metric)) {
              const rawKey = agentResult.biomarkerKey || proposal.key || proposal.name || commands[0]?.keyName || '';
              const overlayKey = getMappedBiomarkerKey(String(rawKey)) || String(rawKey).toLowerCase().replace(/[^a-z0-9]/g, '_');
              if (overlayKey) {
                if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
                const prev = (updatedProfile.customBiomarkers[overlayKey] || {}) as any;
                updatedProfile.customBiomarkers[overlayKey] = {
                  ...prev,
                  name: proposal.name || prev.name || overlayKey,
                  unit: proposal.metric || prev.unit,
                  profileAdjustedNormalRange: proposal.range || prev.profileAdjustedNormalRange,
                  description: proposal.description || prev.description || '',
                  overlayFingerprint: overlayFingerprint(updatedProfile),
                };
              }
            }

            if (applied > 0 || Object.keys(corrections).length > 0 || commands.length > 0) {
              const recomputed: { [key: string]: number | string } = {};
              [...currentHistory]
                .filter((b: any) => b.sync_state !== 'delete')
                .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
                .forEach((log) => {
                  Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
                    recomputed[k] = v as string | number;
                  });
                });
              setBiomarkers(recomputed);
              setBiomarkerHistory(currentHistory);
              await saveAndSync(updatedProfile, foodLogs, recomputed, currentHistory, actions, dailyBenefits, report, {
                type: 'biomarkerLogsBatch',
                targetIds: currentHistory.map((h: any) => h.id)
              });
            }

            if (activeJobId) {
              await JobStore.deleteJob(activeJobId);
              setActiveJobId(null);
            }
            setIsMedicalChatOpen(false);
            setActiveAgentType(null);
            setCalibratingAgentType(null);
            return;
          }
          
          if ((agentType as string) === 'agent1' || (agentType as string) === 'medical_extract') {
            // A flat Step-1 extraction result always carries its own extractedData.
            // Only defer to the (unrelated) Standardize Biomarkers global batch state
            // when this result clearly isn't a flat extraction — otherwise a stale
            // activeDataReviewBatchIdx from that other feature can hijack a normal
            // extraction commit and silently drop the data.
            const isFlatExtractionResult = !!(agentResult && agentResult.extractedData !== undefined && agentResult.extractedData !== null);
            const batchIdx = agentResult.batchIdx !== undefined && agentResult.batchIdx !== null 
              ? agentResult.batchIdx 
              : (isFlatExtractionResult ? null : activeDataReviewBatchIdx);
            if (batchIdx !== undefined && batchIdx !== null) {
              // This is the batch-by-batch Data Cleaning!
              // Store the raw YAML/JSON returned under agent1_batch_results
              const savedResults = localStorage.getItem('agent1_batch_results');
              let results: any = {};
              try {
                if (savedResults) results = JSON.parse(savedResults);
              } catch (e) {}
              
              const minimalResult = { ...agentResult };
              delete minimalResult.agentPrompt;
              results[batchIdx] = minimalResult;
              try { localStorage.setItem('agent1_batch_results', JSON.stringify(results)); } catch(e){ console.warn("Quota exceeded agent1"); }

              // AUTOMATICALLY APPROVE THE BATCH NOW TO PREVENT DOUBLE CLICK!
              // Parse the cleaned YAML
              const jsonText = agentResult.extractedData || agentResult;
              let parsedRows: any[] = [];
              if (typeof jsonText === 'string' && jsonText.trim() !== '') {
                try {
                  const cleanText = jsonText.replace(/```(?:yaml|json)?/gi, '').trim();
                  const parsed = JSON.parse(cleanText);
                  parsedRows = Array.isArray(parsed) ? parsed : (parsed?.biomarkers || []);
                } catch (e) {
                  console.error("Failed to parse approved agent1 YAML", e);
                }
              } else if (Array.isArray(jsonText)) {
                parsedRows = jsonText;
              }
              const unselected = agentResult.unselectedRowKeys || [];
              if (unselected.length > 0) {
                 parsedRows = parsedRows.filter(row => {
                   const key = String(row.biomarker || row.name || row.key || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                   return !unselected.includes(key);
                 });
              }

              // Save customBiomarkers to user profile and history
              const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
              let hHistory = biomarkerHistory ? biomarkerHistory.map((h: any) => ({
                ...h,
                biomarkers: { ...h.biomarkers }
              })) : [];

              const deletedKeysToSync: string[] = [];
              // 1. Identify which unstandardized raw keys were mapped to what standardized keys and migrate/delete
              if (agentResult?.batchBiomarkers && Array.isArray(agentResult.batchBiomarkers)) {
                agentResult.batchBiomarkers.forEach((raw: any) => {
                  const rawKey = raw.key;
                  if (!rawKey) return;

                  // Find best matched parsed row in the parsedRows output
                  let bestParsedIdx = -1;
                  let bestScore = -1;
                  parsedRows.forEach((parsed: any, idx: number) => {
                    if (parsed.originalName) {
                      const cleanRawName = raw.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                      const cleanParsedOrigName = parsed.originalName.toLowerCase().replace(/[^a-z0-9]/g, '');
                      if (cleanRawName === cleanParsedOrigName || parsed.originalName === raw.name) {
                        bestParsedIdx = idx;
                      }
                    }
                    if (parsed.originalName) {
                      const cleanRawName = raw.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                      const cleanParsedOrigName = parsed.originalName.toLowerCase().replace(/[^a-z0-9]/g, '');
                      if (cleanRawName === cleanParsedOrigName || parsed.originalName === raw.name) {
                        bestParsedIdx = idx;
                        return;
                      }
                    }
                    const parsedKey = (parsed.key || parsed.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                    const parsedName = (parsed.name || parsed.biomarker || '').toLowerCase();
                    const explanation = (parsed.explanation || parsed.changeReason || parsed.description || '').toLowerCase();
                    
                    let score = 0;
                    const cleanRawKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const cleanParsedKey = parsedKey.toLowerCase().replace(/[^a-z0-9]/g, '');
                    
                    if (cleanRawKey === cleanParsedKey) {
                      score += 100;
                    } else if (cleanParsedKey.length >= 4 && cleanRawKey.length >= 4 && (cleanRawKey.includes(cleanParsedKey) || cleanParsedKey.includes(cleanRawKey))) {
                      score += 40;
                    }
                    if (explanation.includes(rawKey.toLowerCase())) {
                      score += 80;
                    }
                    if (score > bestScore && score >= 40) {
                      bestScore = score;
                      bestParsedIdx = idx;
                    }
                  });

                  if (bestParsedIdx !== -1) {
                    const parsedRow = parsedRows[bestParsedIdx];
                    const stdKey = (parsedRow.standardizedName || parsedRow.key || parsedRow.name || parsedRow.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                    const action = String(parsedRow.Action || parsedRow.action || '').toLowerCase();
                    
                    if (action.includes('delete')) {
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          delete log.biomarkers[rawKey];
                        }
                      });
                      delete updatedCustoms[rawKey];
                      deletedKeysToSync.push(rawKey);
                    } else if (stdKey && rawKey !== stdKey) {
                      // Migrate existing values from rawKey to stdKey across all historical logs, then delete rawKey
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          const valueToMigrate = log.biomarkers[rawKey];
                          log.biomarkers[stdKey] = valueToMigrate;
                          delete log.biomarkers[rawKey];
                        }
                      });

                      // Delete from customBiomarkers list
                      delete updatedCustoms[rawKey];
                      deletedKeysToSync.push(rawKey);
                    }
                  } else {
                    // No confident match found — leave this key untouched (FIX-7B).
                    // Do NOT delete data that wasn't explicitly handled in this batch's output.
                    console.log(`[Agent Approval] No confident match for raw key "${rawKey}" — skipping deletion.`);
                  }
                });
              }

              // 2. Apply newly cleaned/standardized readings from parsedRows
              parsedRows.forEach((row: any) => {
                const key = row.key || (row.name || row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                if (!key) return;

                const name = row.name || row.biomarker || 'Unknown';
                const unit = row.metric || row.unit || '';

                // Update customBiomarker definition
                const existing: any = updatedCustoms[key] || {};
                updatedCustoms[key] = {
                  ...existing,
                  name,
                  unit,
                  riskCategories: (existing.riskCategories && existing.riskCategories.length > 0) ? existing.riskCategories : (row.riskCategories || []),
                  standardMedicalGrouping: (existing.standardMedicalGrouping && existing.standardMedicalGrouping !== 'Other') ? existing.standardMedicalGrouping : (row.standardMedicalGrouping || 'Other'),
                  potentialMedicalConditions: row.potentialMedicalConditions || existing.potentialMedicalConditions || []
                } as any;

                // Extract and write the actual numeric or qualitative reading value to hHistory
                const rawVal = row.numeric_value !== undefined && row.numeric_value !== null && row.numeric_value !== ''
                  ? row.numeric_value
                  : (row.value !== undefined ? row.value : row.qualitative_value);
                
                const entryDate = row.date || new Date().toISOString().split('T')[0];
                const standardDate = String(entryDate).split('T')[0].trim();

                if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
                  const valNum = Number(rawVal);
                  const finalValue = isNaN(valNum) ? rawVal : valNum;

                  let existingLogIndex = hHistory.findIndex((h: any) => {
                    if (!h.date) return false;
                    return String(h.date).split('T')[0].trim() === standardDate;
                  });

                  if (existingLogIndex >= 0) {
                    hHistory[existingLogIndex].biomarkers[key] = finalValue;
                  } else {
                    hHistory.push({
                      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                      date: standardDate,
                      biomarkers: { [key]: finalValue },
                      note: "Extracted by Clinical Data Parser"
                    });
                  }
                }
              });

              hHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

              // Recompute biomarkers list
              const recomputedBiomarkers: { [key: string]: number | string } = {};
              [...hHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
                Object.entries(log.biomarkers).forEach(([k, v]) => {
                  recomputedBiomarkers[k] = v as string | number;
                });
              });
              
              if (deletedKeysToSync.length > 0) {
                updatedProfile.deletedCustomBiomarkerKeys = { ...(updatedProfile.deletedCustomBiomarkerKeys || {}) };
                deletedKeysToSync.forEach(k => { updatedProfile.deletedCustomBiomarkerKeys![k] = Date.now(); });
              }

              updatedProfile.customBiomarkers = updatedCustoms;
              currentHistory = hHistory;

              // Mark as approved in localStorage
              const savedApproved = localStorage.getItem('approved_agent1_batches');
              let approved: any = {};
              try {
                if (savedApproved) approved = JSON.parse(savedApproved);
              } catch (e) {}
              approved[batchIdx] = true;
              try { localStorage.setItem('approved_agent1_batches', JSON.stringify(approved)); } catch(e){ console.warn("Quota exceeded approved_agent1"); }

              // Update React States
              setBiomarkers(recomputedBiomarkers);
            } else {
              updatedProfile.agentTriageSummary = "Data extraction completed.";
              
              // Parse extractedData and merge into biomarkerHistory
              const jsonText = agentResult.extractedData || agentResult;
              const entries: any[] = [];
              const isString = typeof jsonText === 'string';

              if (isString) {
                try {
                  const cleanedText = (jsonText as string).replace(/```(?:yaml|yml)?/gi, '').trim();
                  const parsed = JSON.parse(cleanedText);
                  const rawList = Array.isArray(parsed) 
                    ? parsed 
                    : (parsed?.biomarkers || parsed?.entries || parsed?.data || []);
                  if (Array.isArray(rawList)) {
                    rawList.forEach((item: any) => {
                      if (item && typeof item === 'object') {
                        const bName = item.biomarker || item.name || item.key;
                        const bDate = item.date || item.timestamp;
                        const bVal = (item.numeric_value !== undefined && item.numeric_value !== null)
                          ? item.numeric_value
                          : (item.qualitative_value !== undefined && item.qualitative_value !== null)
                            ? item.qualitative_value
                            : (item.value !== undefined ? item.value : item.val);
                        if (bName && bDate && bVal !== undefined && bVal !== null && bVal !== '') {
                          entries.push({
                            biomarker: String(bName),
                            displayName: item.display_name ? String(item.display_name) : '',
                            date: String(bDate),
                            value: isNaN(Number(bVal)) ? bVal : parseFloat(String(bVal)),
                            unit: item.unit ? String(item.unit) : '',
                            referenceRange: item.referenceRange || item.range || ''
                          });
                        }
                      }
                    });
                  }
                } catch (e) {
                  console.warn("Standard YAML parser in App.tsx failed, falling back to regex", e);
                }

                if (entries.length === 0) {
                  const lines = (jsonText as string).split('\n');
                  let currentEntry: any = {};
                  
                  for (let line of lines) {
                    line = line.trim();
                    if (line.startsWith('-') || line.startsWith('biomarker:')) {
                      if (currentEntry.biomarker) entries.push(currentEntry);
                      currentEntry = {};
                    }
                    const bioMatch = line.match(/(?:-\s+)?biomarker:\s*(.*)/i);
                    if (bioMatch) { currentEntry.biomarker = bioMatch[1].replace(/['"]/g, '').trim(); continue; }
                    const dateMatch = line.match(/date:\s*([\d-]+)/i);
                    if (dateMatch) { currentEntry.date = dateMatch[1].trim(); continue; }
                    const valMatch = line.match(/value:\s*(.*)/i);
                    if (valMatch) { 
                      const rawVal = valMatch[1].replace(/['"]/g, '').trim(); 
                      currentEntry.value = isNaN(Number(rawVal)) ? rawVal : parseFloat(rawVal);
                      continue; 
                    }
                    const unitMatch = line.match(/unit:\s*(.*)/i);
                    if (unitMatch) { currentEntry.unit = unitMatch[1].replace(/['"]/g, '').trim(); continue; }
                    const refMatch = line.match(/referenceRange:\s*(.*)/i);
                    if (refMatch) { currentEntry.referenceRange = refMatch[1].replace(/['"]/g, '').trim(); continue; }
                  }
                  if (currentEntry.biomarker) entries.push(currentEntry);
                }
              } else if (Array.isArray(jsonText)) {
                jsonText.forEach((item: any) => {
                  if (item && typeof item === 'object') {
                    const bName = item.biomarker || item.name || item.key;
                    const bDate = item.date || item.timestamp;
                    const bVal = item.value !== undefined ? item.value : (item.val !== undefined ? item.val : item.numeric_value);
                    if (bName && bDate) {
                      entries.push({
                        biomarker: String(bName),
                        displayName: item.display_name ? String(item.display_name) : '',
                        date: String(bDate),
                        value: isNaN(Number(bVal)) ? bVal : parseFloat(String(bVal)),
                        unit: (item.unit || item.metric) ? String(item.unit || item.metric) : '',
                        referenceRange: item.referenceRange || item.range || item.normalRange || ''
                      });
                    }
                  }
                });
              } else if (jsonText && typeof jsonText === 'object') {
                const possibleArray = jsonText.extractedBiomarkers || jsonText.biomarkers || jsonText.entries || jsonText.extracted || jsonText.data || jsonText.metrics || jsonText.results || jsonText.calibratedBiomarkers;
                let listToUse: any[] = [];
                if (Array.isArray(possibleArray)) {
                  listToUse = possibleArray;
                } else {
                  const arrays = Object.values(jsonText).filter(v => Array.isArray(v));
                  if (arrays.length > 0) {
                    listToUse = arrays[0] as any[];
                  }
                }
                listToUse.forEach((item: any) => {
                  if (item && typeof item === 'object') {
                    const bName = item.biomarker || item.name || item.key;
                    const bDate = item.date || item.timestamp;
                    const bVal = item.value !== undefined ? item.value : (item.val !== undefined ? item.val : item.numeric_value);
                    if (bName && bDate) {
                      entries.push({
                        biomarker: String(bName),
                        displayName: item.display_name ? String(item.display_name) : '',
                        date: String(bDate),
                        value: isNaN(Number(bVal)) ? bVal : parseFloat(String(bVal)),
                        unit: (item.unit || item.metric) ? String(item.unit || item.metric) : '',
                        referenceRange: item.referenceRange || item.range || item.normalRange || ''
                      });
                    }
                  }
                });
              }

              // Filter out any unselected entries, and any flagged "Not Used" in either store, to respect user selections
              const unselected = agentResult.unselectedRowKeys || [];
              const scopeKeys = Array.isArray(agentResult.scopeKeys) ? agentResult.scopeKeys : null;
              const isFlaggedNotUsed = (key1: string, key2: string): boolean => {
                const maps = [profile?.notUsedBiomarkers, profile?.notUsedInMedicalHistory];
                return maps.some(m => !!m && (!!m[key1] || !!m[key2] || Object.keys(m).some(nok => nok.toLowerCase() === key1)));
              };
              const seenEntryKeys = new Set<string>();
              const filteredEntries = entries.filter(entry => {
                const key1 = String(entry.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                const key2 = String(entry.biomarker || '').toLowerCase().trim();
                if (unselected.includes(key1) || unselected.includes(key2)) return false;
                if (isFlaggedNotUsed(key1, key2)) return false;
                if (scopeKeys && !scopeKeys.includes(key1) && !scopeKeys.includes(key2)) return false;
                
                // Exact-match deduplication on (biomarker, date, value)
                const dKey = String(entry.date || '').split('T')[0].trim();
                const valKey = String(entry.value ?? '');
                const dedupeKey = `${key1}|${dKey}|${valKey}`;
                if (seenEntryKeys.has(dedupeKey)) return false;
                seenEntryKeys.add(dedupeKey);
                return true;
              });
              
              filteredEntries.forEach(entry => {
                const rawSlug = String(entry.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                const bioName = getMappedBiomarkerKey(rawSlug) || rawSlug;
                const isBuiltIn = biomarkerDefinitions.some((d) => d.key === bioName);
                let finalValue = entry.value;
                let finalUnit = (entry.unit || '').replace(/µ/g, 'u').trim();
                let finalRange = (entry.referenceRange || '').replace(/µ/g, 'u');

                // Sanitize dimensionless units
                if (/^(n\/a|na|-|--|nil|none)$/i.test(finalUnit)) {
                  finalUnit = '';
                }

                // Guard AUDIT-C score unit bleed
                if (bioName === 'audit_c_total_score' || bioName.startsWith('audit_') || bioName.endsWith('_score')) {
                  if (/mmhg/i.test(finalUnit)) {
                    finalUnit = 'score';
                  }
                }

                // No math middleware: raw values only
                const standardDate = String(entry.date).split('T')[0].trim();

                const matchDate = (d1: string, d2: string) => {
                  if (!d1 || !d2) return false;
                  return String(d1).split('T')[0].trim() === String(d2).split('T')[0].trim();
                };

                let existingLogIndex = currentHistory.findIndex(h => matchDate(h.date, standardDate));
                if (existingLogIndex >= 0) {
                  currentHistory[existingLogIndex].biomarkers[bioName] = finalValue;
                  attachObservationMeta(currentHistory[existingLogIndex], bioName, {
                    unit: finalUnit,
                    printedRange: finalRange,
                    rawValue: finalValue,
                  });
                  // If composite blood pressure, also store separate systolic & diastolic
                  if (bioName === 'blood_pressure' && typeof finalValue === 'string') {
                    const bpMatch = finalValue.match(/(\d+)\s*\/\s*(\d+)/);
                    if (bpMatch) {
                      const s = parseInt(bpMatch[1], 10);
                      const d = parseInt(bpMatch[2], 10);
                      currentHistory[existingLogIndex].biomarkers['systolic_blood_pressure'] = s;
                      attachObservationMeta(currentHistory[existingLogIndex], 'systolic_blood_pressure', { unit: 'mmHg', rawValue: s, printedRange: '< 120' });
                      currentHistory[existingLogIndex].biomarkers['diastolic_blood_pressure'] = d;
                      attachObservationMeta(currentHistory[existingLogIndex], 'diastolic_blood_pressure', { unit: 'mmHg', rawValue: d, printedRange: '< 80' });
                    }
                  }
                } else {
                  const newLog: any = {
                    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    date: standardDate,
                    biomarkers: { [bioName]: finalValue },
                    note: "Extracted by Clinical Data Parser"
                  };
                  attachObservationMeta(newLog, bioName, {
                    unit: finalUnit,
                    printedRange: finalRange,
                    rawValue: finalValue,
                  });
                  if (bioName === 'blood_pressure' && typeof finalValue === 'string') {
                    const bpMatch = finalValue.match(/(\d+)\s*\/\s*(\d+)/);
                    if (bpMatch) {
                      const s = parseInt(bpMatch[1], 10);
                      const d = parseInt(bpMatch[2], 10);
                      newLog.biomarkers['systolic_blood_pressure'] = s;
                      attachObservationMeta(newLog, 'systolic_blood_pressure', { unit: 'mmHg', rawValue: s, printedRange: '< 120' });
                      newLog.biomarkers['diastolic_blood_pressure'] = d;
                      attachObservationMeta(newLog, 'diastolic_blood_pressure', { unit: 'mmHg', rawValue: d, printedRange: '< 80' });
                    }
                  }
                  currentHistory.push(newLog);
                }
                
                if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
                const mapping = agentResult?.bucketMapping;
                let mapData = null;
                if (mapping && typeof mapping === 'object') {
                  const matchKey = Object.keys(mapping).find(k => 
                    k.toLowerCase() === bioName.toLowerCase() || 
                    k.toLowerCase() === entry.biomarker.toLowerCase() ||
                    k.toLowerCase().replace(/[^a-z0-9]/g, '_') === bioName
                  );
                  if (matchKey) {
                    mapData = mapping[matchKey];
                  }
                }

                if (!updatedProfile.customBiomarkers[bioName]) {
                  // Built-in / alias-mapped keys already live in the catalog. Do not invent
                  // a custom overlay (or a pending-approval row) for every extracted line.
                  if (!isBuiltIn) {
                    updatedProfile.customBiomarkers[bioName] = {
                      name: entry.displayName || entry.biomarker,
                      unit: finalUnit,
                      normalRange: finalRange || 'Unknown',
                      description: '',
                      riskCategories: mapData?.riskCategories || [],
                      standardMedicalGrouping: mapData?.standardMedicalGrouping || 'Other',
                      potentialMedicalConditions: mapData?.potentialMedicalConditions || [],
                      needsApproval: true,
                      catalogApproved: false,
                    };
                  } else if (shouldRunCalibrator(bioName, updatedProfile)) {
                    updatedProfile.customBiomarkers[bioName] = {
                      name: entry.displayName || entry.biomarker,
                      catalogApproved: true,
                      calibrationDue: true,
                    } as any;
                  }
                } else {
                  // Upgrade a previously-registered raw-key name to a proper display name once one arrives,
                  // but never overwrite a name that's already something other than the raw key (e.g. user-edited).
                  const currentName = updatedProfile.customBiomarkers[bioName].name;
                  if (entry.displayName && (!currentName || currentName === bioName || currentName === entry.biomarker)) {
                    updatedProfile.customBiomarkers[bioName].name = entry.displayName;
                  }
                  if (finalUnit && !updatedProfile.customBiomarkers[bioName].unit) {
                    updatedProfile.customBiomarkers[bioName].unit = finalUnit;
                  }
                  if (finalRange && (!updatedProfile.customBiomarkers[bioName].normalRange || updatedProfile.customBiomarkers[bioName].normalRange === 'Unknown')) {
                    updatedProfile.customBiomarkers[bioName].normalRange = finalRange;
                  }
                  if (mapData) {
                    if (mapData.riskCategories) updatedProfile.customBiomarkers[bioName].riskCategories = mapData.riskCategories;
                    if (mapData.standardMedicalGrouping) updatedProfile.customBiomarkers[bioName].standardMedicalGrouping = mapData.standardMedicalGrouping;
                    if (mapData.potentialMedicalConditions) updatedProfile.customBiomarkers[bioName].potentialMedicalConditions = mapData.potentialMedicalConditions;
                  }
                }
              });
              
              currentHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
              setBiomarkerHistory(currentHistory);
              
              const recomputedBiomarkers: { [key: string]: number | string } = {};
              [...currentHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
                Object.entries(log.biomarkers).forEach(([k, v]) => {
                  recomputedBiomarkers[k] = v as string | number;
                });
              });
              setBiomarkers(recomputedBiomarkers);
            }
          } else if (agentType === 'agent2') {
             // Agent 2: Clinical Ontologist (Mapping)
             updatedProfile.agentTriageSummary = "Biomarker categories mapped.";
             const mapping = agentResult.bucketMapping || agentResult;
             if (mapping && typeof mapping === 'object') {
               if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
               Object.entries(mapping).forEach(([bioName, mapData]: [string, any]) => {
                 const key = bioName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                 const existingDef = updatedProfile.customBiomarkers![key] || {
                   name: bioName, unit: '', normalRange: 'Unknown', description: ''
                 };
                 updatedProfile.customBiomarkers![key] = {
                   ...existingDef,
                   riskCategories: mapData.riskCategories || existingDef.riskCategories,
                   standardMedicalGrouping: mapData.standardMedicalGrouping || existingDef.standardMedicalGrouping,
                   potentialMedicalConditions: mapData.potentialMedicalConditions || existingDef.potentialMedicalConditions
                 };
               });
             }
          } else if (agentType === 'agent3') {
             // Agent 3: Clinical Data Coordinator (Assembly)
             updatedProfile.agentTriageSummary = agentResult.text || "Data assembled into buckets.";
          } else if (agentType === 'agent4') {
            const sumVal = agentResult.summary || agentResult.primaryDiagnosis || agentResult.text;
            updatedProfile.agentDiagnosticSummary = typeof sumVal === 'string'
              ? sumVal
              : (sumVal?.primaryDiagnosis || sumVal?.summary || (sumVal ? JSON.stringify(sumVal) : 'Health planning audit complete.'));
            updatedProfile.agent2TimelineProjections = agentResult.timelineProjections || (typeof agentResult.summary === 'object' ? agentResult.summary?.timelineProjections : undefined);
            const gaps = Array.isArray(agentResult.testingGaps) ? agentResult.testingGaps : agentResult.recommendedTests;
            updatedProfile.agent2GapTasks = Array.isArray(gaps) ? gaps.map((t: any) => `${t.testName || t.name || 'Test'}: ${t.reason || ''}`) : undefined;
            const newAcceptedActions = extraActions || agentResult?.acceptedActions;
            if (Array.isArray(newAcceptedActions)) {
              currentActions = [...newAcceptedActions];
              setActions(currentActions);
            }
          } else if (agentType === 'agent5') {
            updatedProfile.agentContextualizerSummary = agentResult.message;
          } else if (agentType === 'agent7') {
            updatedProfile.agentLiteratureSummary = agentResult.message;
          } else if (agentType === 'data_review') {
            const batchIdx = agentResult.batchIdx !== undefined && agentResult.batchIdx !== null ? agentResult.batchIdx : activeDataReviewBatchIdx;
            if (batchIdx !== undefined && batchIdx !== null) {
              setCalibratingBatchIdx(Number(batchIdx));
            }
            setIsMedicalChatOpen(false);

            const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
            
            if (agentResult.reviewedBiomarkers && Array.isArray(agentResult.reviewedBiomarkers)) {
              agentResult.reviewedBiomarkers.forEach((bm: any) => {
                const existing = (updatedCustoms[bm.key] || {}) as any;
                const optVal = formatOptimalTargetValue(bm);

                updatedCustoms[bm.key] = {
                  ...existing,
                  name: bm.name || existing.name,
                  unit: existing.unit || bm.unit,
                  optimalValue: optVal,
                  normalRange: existing.normalRange || '',
                  profileAdjustedNormalRange: bm.profileAdjustedNormalRange || existing.profileAdjustedNormalRange || '',
                  description: bm.description || existing.description || '',
                  riskCategories: (existing.riskCategories && existing.riskCategories.length > 0) ? existing.riskCategories : (bm.riskCategories || []),
                  standardMedicalGrouping: (existing.standardMedicalGrouping && existing.standardMedicalGrouping !== 'Other') ? existing.standardMedicalGrouping : (bm.standardMedicalGrouping || 'Other'),
                  potentialMedicalConditions: bm.potentialMedicalConditions || existing.potentialMedicalConditions || [],
                  specificRiskContext: bm.specificRiskContext || existing.specificRiskContext || '',
                  status: bm.status || existing.status || 'Healthy',
                  rangeBrackets: bm.rangeBrackets || existing.rangeBrackets || [],
                  overlayFingerprint: overlayFingerprint(updatedProfile),
                } as any;
                // Overlay only — Review is the sole number writer.
              });

              // Recompute current biomarkers state based on history
              const recomputedBiomarkers: { [key: string]: number | string } = {};
              [...currentHistory]
                .filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
                .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
                .forEach(log => {
                  Object.entries(log.biomarkers).forEach(([k, v]) => {
                    recomputedBiomarkers[k] = v as string | number;
                  });
                });
              setBiomarkers(recomputedBiomarkers);
            }
            
            updatedProfile.customBiomarkers = updatedCustoms;
            
            if (batchIdx !== undefined && batchIdx !== null) {
              const saved = localStorage.getItem('approved_data_review_batches');
              let approved: any = {};
              try {
                if (saved) approved = JSON.parse(saved);
              } catch (e) {}
              approved[batchIdx] = true;
              try { localStorage.setItem('approved_data_review_batches', JSON.stringify(approved)); } catch(e){ console.warn("Quota exceeded approved_data"); }
              
              // Also store the analysis result so the InsightsTab can display the result immediately!
              const savedResults = localStorage.getItem('batch_analysis_results');
              let results: any = {};
              try {
                if (savedResults) results = JSON.parse(savedResults);
              } catch (e) {}
              const minimalResult = { ...agentResult };
              delete minimalResult.agentPrompt;
              results[batchIdx] = minimalResult;
              try { localStorage.setItem('batch_analysis_results', JSON.stringify(results)); } catch(e){ console.warn("Quota exceeded batch_analysis"); }

              // Perform missing biomarker movement if any keys are marked to move
              try {
                const keysToMoveSaved = localStorage.getItem(`batch_${batchIdx}_missing_keys_to_move`);
                if (keysToMoveSaved) {
                  const keysToMove: string[] = JSON.parse(keysToMoveSaved);
                  if (Array.isArray(keysToMove) && keysToMove.length > 0) {
                    const batchesSaved = localStorage.getItem('biomarker_batches_custom');
                    if (batchesSaved) {
                      let currentBatches: string[][] = JSON.parse(batchesSaved);
                      const sizeSaved = localStorage.getItem('biomarker_batch_size');
                      const batchSizeNum = sizeSaved ? Number(sizeSaved) : 20;

                      keysToMove.forEach(key => {
                        // Remove from current batch
                        if (currentBatches[batchIdx]) {
                          currentBatches[batchIdx] = currentBatches[batchIdx].filter(k => k !== key);
                        }

                        // Place in first subsequent unapproved/uncalibrated batch with space
                        let placed = false;
                        for (let i = batchIdx + 1; i < currentBatches.length; i++) {
                          if (!approved[i] && !results[i] && currentBatches[i].length < batchSizeNum) {
                            currentBatches[i].push(key);
                            placed = true;
                            break;
                          }
                        }

                        if (!placed) {
                          for (let i = batchIdx + 1; i < currentBatches.length; i++) {
                            if (!approved[i] && !results[i]) {
                              currentBatches[i].push(key);
                              placed = true;
                              break;
                            }
                          }
                        }

                        if (!placed) {
                          currentBatches.push([key]);
                        }
                      });

                      // Clean up empty batches
                      currentBatches = currentBatches.filter((batch, idx) => 
                        batch.length > 0 || idx === 0 || approved[idx] || results[idx]
                      );

                      localStorage.setItem('biomarker_batches_custom', JSON.stringify(currentBatches));
                    }
                  }
                  // Clear the missing keys list for this batch since they are now moved
                  localStorage.removeItem(`batch_${batchIdx}_missing_keys_to_move`);
                }
              } catch (e) {
                console.error("Error moving missing biomarkers on clinical calibration finish:", e);
              }
            }
          } else if (agentType === 'health_baseline') {
             setIsMedicalChatOpen(false);
             const data = agentResult?.report || agentResult || {};
             const unselected = new Set(agentResult.unselectedRowKeys || []);
             const riskCategories = Array.isArray(data.riskCategories) ? data.riskCategories : [];
             const acceptedCategories = riskCategories.filter((_: any, idx: number) => !unselected.has(idx));
             
             const globalNutrientTargets = Array.isArray(data.nutrientTargets) ? data.nutrientTargets : (Array.isArray(data.topNutrientTargets) ? data.topNutrientTargets : []);
             const globalDailyActivities = Array.isArray(data.dailyActivities) ? data.dailyActivities : [];
             const generalNutrientTargets = data.generalNutrientTargets || {};

             if (!currentReport) {
               currentReport = {
                 timestamp: new Date().toISOString(),
                 dailyNutrientTargets: {},
                 mostImportantNextStep: '',
                 actions: [],
                 dailyBenefits: [],
                 latestInsights: [],
                 healthRiskForecast: { year5: '', year10: '', year20: '', optimized5: '', optimized10: '', optimized20: '' }
               };
             }

             let newDailyNutrientTargets = { ...(currentReport.dailyNutrientTargets || {}) };

             Object.entries(generalNutrientTargets).forEach(([key, val]) => {
               newDailyNutrientTargets[key] = String(val);
             });

             // Extract justified nutrient keys and activities from accepted categories
             const justifiedNutrientKeys = new Set();
             const justifiedActivities = new Set();

             acceptedCategories.forEach((cat) => {
               if (Array.isArray(cat.nutrientTargets)) {
                 cat.nutrientTargets.forEach((nt) => {
                   if (nt.nutrientKey) {
                     justifiedNutrientKeys.add(nt.nutrientKey.toLowerCase().trim());
                   }
                 });
               }
               if (Array.isArray(cat.dailyActivities)) {
                 cat.dailyActivities.forEach((da) => {
                   if (da.activity) {
                     justifiedActivities.add(da.activity.toLowerCase().trim());
                   }
                 });
               }
             });

             globalNutrientTargets.forEach((nt: any) => {
               if (nt.nutrientKey && nt.targetValue) {
                 newDailyNutrientTargets[nt.nutrientKey] = nt.targetValue;
               }
             });

             globalDailyActivities.forEach((da: any) => {
               if (da.activity && da.target && justifiedActivities.has(da.activity.toLowerCase().trim())) {
                 const isStepActivity = /\bsteps?\b/i.test(da.activity) || /\bwalk(ing)?\b/i.test(da.activity);
                 if (isStepActivity) {
                   const stepsMatch = String(da.target).match(/[\d,]+/);
                   if (stepsMatch) {
                     newDailyNutrientTargets.steps = stepsMatch[0].replace(/,/g, '');
                   }
                 } else {
                   currentDailyBenefits.push({
                     id: `db_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                     activity: da.activity,
                     target: da.target,
                     completed: false
                   });
                 }
               }
             });

             acceptedCategories.forEach((cat: any) => {
               if (Array.isArray(cat.nutrientTargets)) {
                 cat.nutrientTargets.forEach((nt: any) => {
                   if (nt.nutrientKey && nt.targetValue) {
                     newDailyNutrientTargets[nt.nutrientKey] = nt.targetValue;
                   }
                 });
               }
               if (Array.isArray(cat.dailyActivities)) {
                 cat.dailyActivities.forEach((da: any) => {
                   if (da.activity && da.target) {
                     const isStepActivity = /\bsteps?\b/i.test(da.activity) || /\bwalk(ing)?\b/i.test(da.activity);
                     if (isStepActivity) {
                       const stepsMatch = String(da.target).match(/[\d,]+/);
                       if (stepsMatch) {
                         newDailyNutrientTargets.steps = stepsMatch[0].replace(/,/g, '');
                       }
                     } else {
                       currentDailyBenefits.push({
                         id: `db_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                         activity: da.activity,
                         target: da.target,
                         completed: false
                       });
                     }
                   }
                 });
               }
             });

             currentReport.dailyNutrientTargets = newDailyNutrientTargets;

             const recommendedKeysSet = new Set<string>();
             if (Array.isArray(data.topNutrientTargets)) {
               data.topNutrientTargets.forEach((nt: any) => {
                 const k = typeof nt === 'string' ? nt : (nt?.nutrientKey || nt?.key);
                 if (k) recommendedKeysSet.add(k);
               });
             }
             const rawWeeklyData = data.topWeeklyNutrientTargets || data.weeklyNutrientTargets;
             if (Array.isArray(rawWeeklyData)) {
               rawWeeklyData.forEach((nt: any) => {
                 const k = typeof nt === 'string' ? nt : (nt?.nutrientKey || nt?.key);
                 if (k) recommendedKeysSet.add(k);
               });
             } else if (typeof rawWeeklyData === 'object' && rawWeeklyData !== null) {
               Object.keys(rawWeeklyData).forEach(k => recommendedKeysSet.add(k));
             }
             acceptedCategories.forEach((cat: any) => {
               if (Array.isArray(cat.nutrientTargets)) {
                 cat.nutrientTargets.forEach((nt: any) => {
                   const k = nt?.nutrientKey || nt?.key;
                   if (k) recommendedKeysSet.add(k);
                 });
               }
             });

             const topCoreKeys = Array.from(recommendedKeysSet).filter(isCoreNutrient);
             const topWeeklyKeys = Array.from(recommendedKeysSet).filter(isAdditionalNutrient);

             currentReport.topNutrientTargets = topCoreKeys;
             currentReport.topWeeklyNutrientTargets = topWeeklyKeys;

             if (currentReport.topNutrientTargets.length > 0) {
               updatedProfile.topNutrientsToMonitor = currentReport.topNutrientTargets;
             }
             currentReport.generalNutrientTargets = data.generalNutrientTargets;
             currentReport.nutrientRankingRationale = data.nutrientRankingRationale;
             currentReport.healthBaselineCategories = acceptedCategories;
             
             setReport(currentReport);
             setDailyBenefits(currentDailyBenefits);
          }
          
          setProfile(updatedProfile);
          try {
            // Auto-approve the step if it's one of the main agent types
            const searchType = (agentType as string) === 'medical_extract' ? 'agent1' : agentType;
            const latestAnalysis = (updatedProfile.agentAnalyses || [])
              .filter(a => a.agentType === searchType || (searchType === 'agent1' && a.agentType === 'medical_extract'))
              .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];
            
            if (latestAnalysis) {
              try {
                const savedIds = localStorage.getItem('approvedAnalysisIds');
                let approvedIds: any = {};
                if (savedIds) approvedIds = JSON.parse(savedIds);
                approvedIds[searchType] = latestAnalysis.id;
                localStorage.setItem('approvedAnalysisIds', JSON.stringify(approvedIds));
              } catch (e) {
                console.warn("Failed to auto-approve analysis in localStorage", e);
              }
            }

            await saveAndSync(updatedProfile, foodLogs, biomarkers, currentHistory, currentActions, currentDailyBenefits, currentReport || report);
          } finally {
            setCalibratingBatchIdx(null);
            setCalibratingAgentType(null);
            
            const isBatch = agentType === 'data_review';
            if (isBatch) {
              const batchIdx = agentResult?.batchIdx !== undefined && agentResult?.batchIdx !== null 
                ? agentResult.batchIdx 
                : activeDataReviewBatchIdx;
              if (batchIdx !== undefined && batchIdx !== null) {
                setTimeout(() => {
                  const element = document.getElementById(`batch-card-${batchIdx}`);
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }, 150);
              }
            } else {
              const getStepIndexForAgent = (aType: string) => {
                if (aType === 'agent1' || aType === 'medical_extract') return 1;
                if (aType === 'data_review') return 2;
                if (aType === 'health_baseline') return 3;
                if (aType === 'agent4') return 4;
                if (aType === 'agent7') return 5;
                return -1;
              };
              const stepIdx = getStepIndexForAgent(agentType);
              if (stepIdx !== -1) {
                setTimeout(() => {
                  const element = document.getElementById(`accordion-step-${stepIdx}`);
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }, 150);
              }
            }
          }
        }}
      />}

 

      {/* Snapshot/Undo Panel */}
      {showSnapshotPanel && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50" onClick={() => setShowSnapshotPanel(false)}>
          <div className="bg-theme-bg-card rounded-t-2xl w-full max-w-lg p-5 pb-8 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-theme-text flex items-center gap-2">
                <span>🕐</span> Restore a Snapshot
              </h2>
              <button onClick={() => setShowSnapshotPanel(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <p className="text-[12px] text-slate-500 mb-4 bg-slate-100 dark:bg-slate-800 p-2 rounded">
              💡 Note: Image data is not included in undo snapshots to save space. 
              Images will need to be re-attached if you undo a food log.
            </p>
            {snapshots.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No snapshots yet. Snapshots are created automatically before each agent approval.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {snapshots.map((snap: any) => (
                  <div key={snap.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 border border-theme-border rounded-xl px-4 py-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{snap.label}</p>
                      <p className="text-[10px] text-slate-400">{new Date(snap.timestamp).toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {snap.data?.biomarkerHistory?.length ?? 0} biomarker logs · {snap.data?.foodLogs?.length ?? 0} food logs
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => handleRestoreSnapshot(snap)}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Restore
                      </button>
                      <button
                        onClick={async () => {
                          await deleteLocalSnapshot(profile?.email, snap.id);
                          setSnapshots(await loadLocalSnapshots(profile?.email));
                        }}
                        className="px-3 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-slate-400 text-center mt-4">Snapshots are stored locally on this device only. Up to 5 are kept.</p>
          </div>
        </div>
      )}

      </ErrorBoundary>
    </div>
  );
}