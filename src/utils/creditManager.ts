import { UserProfile } from '../types';
import { getAdminSettings } from './userManagement';

export interface GrantedCredit {
  amount: number;
  expiresAt: string; // ISO string
  grantedAt: string; // ISO string
}

export interface AgentCreditsState {
  totalUsed: number;
  dailyQuota: number;
  remaining: number;
  lastResetTime: string; // ISO String
  grantedCredits?: GrantedCredit[];
  modelUsage?: {
    [modelId: string]: number;
  };
}

// Default cost configurations (fallback only)
export const DEFAULT_AGENT_COSTS = {
  'gemini-3.5-flash-lite': 1,
  'default': 20
};

export const DEFAULT_DAILY_QUOTA = {
  'Admin': 500,
  'Demo': 20,
  'Standard': 100
};

/**
 * Returns the current available agent credits for a user profile,
 * automatically handling daily reset.
 */
export function getAvailableCredits(profile: UserProfile, customCosts?: any): {
  total: number;
  daily: number;
  granted: number;
  nextResetStr: string;
  grantedDetails: GrantedCredit[];
  isDemo: boolean;
  userType: 'Admin' | 'Demo' | 'Standard';
} {
  const userType = profile.userType || (profile.email?.toLowerCase().trim() === 'cwah.liu@gmail.com' ? 'Admin' : (profile.email?.toLowerCase().trim() === 'demo@healthcockpit.com' ? 'Demo' : 'Standard'));
  const isDemo = userType === 'Demo';

  const settings = getAdminSettings();
  const defaultQuota = (userType === 'Admin' 
    ? settings.quotaAdmin 
    : (userType === 'Demo' ? settings.quotaDemo : settings.quotaStandard)) ?? (DEFAULT_DAILY_QUOTA[userType] || 100);
  
  const credits: AgentCreditsState = profile.agentCredits || {
    totalUsed: 0,
    dailyQuota: defaultQuota,
    remaining: defaultQuota,
    lastResetTime: new Date().toISOString(),
    grantedCredits: [],
    modelUsage: {}
  };

  const now = new Date();
  const lastReset = credits.lastResetTime ? new Date(credits.lastResetTime) : new Date(0);
  const isDifferentDay = isNaN(lastReset.getTime()) || now.toDateString() !== lastReset.toDateString();

  let remaining = typeof credits.remaining === 'number' && !isNaN(credits.remaining) ? credits.remaining : defaultQuota;
  let lastResetTime = credits.lastResetTime || now.toISOString();

  if (isDifferentDay) {
    remaining = defaultQuota;
    lastResetTime = now.toISOString();
  }

  // Filter out expired granted credits
  const validGranted = (credits.grantedCredits || []).filter(g => {
    return g && typeof g.amount === 'number' && !isNaN(g.amount) && new Date(g.expiresAt) > now;
  });

  const grantedTotal = validGranted.reduce((sum, g) => sum + (Number(g.amount) || 0), 0);

  // Time remaining to next reset (midnight)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const msToReset = tomorrow.getTime() - now.getTime();
  const hours = Math.floor(msToReset / (1000 * 60 * 60));
  const minutes = Math.floor((msToReset % (1000 * 60 * 60)) / (1000 * 60));
  const nextResetStr = `${hours}h ${minutes}m`;

  const safeDaily = Number(remaining) || 0;
  const safeGranted = Number(grantedTotal) || 0;

  return {
    total: safeDaily + safeGranted,
    daily: safeDaily,
    granted: safeGranted,
    nextResetStr,
    grantedDetails: validGranted,
    isDemo,
    userType
  };
}

/**
 * Deducts the credit cost for invoking a model and returns the updated profile.
 */
export function deductAgentCredits(profile: UserProfile, modelId: string, customCosts?: any): UserProfile {
  const userType = profile.userType || (profile.email?.toLowerCase().trim() === 'cwah.liu@gmail.com' ? 'Admin' : (profile.email?.toLowerCase().trim() === 'demo@healthcockpit.com' ? 'Demo' : 'Standard'));
  
  const settings = getAdminSettings();
  const defaultQuota = (userType === 'Admin' 
    ? settings.quotaAdmin 
    : (userType === 'Demo' ? settings.quotaDemo : settings.quotaStandard)) ?? (DEFAULT_DAILY_QUOTA[userType] || 100);

  const isFlashLite = modelId === 'gemini-3.5-flash-lite' || modelId === 'gemini-3.8-flash' || modelId.toLowerCase().includes('flash-lite');
  const cost = (isFlashLite ? settings.flashLiteCost : settings.standardCost) ?? (isFlashLite ? 1 : 20);

  const updated = { ...profile };
  
  const credits: AgentCreditsState = updated.agentCredits || {
    totalUsed: 0,
    dailyQuota: defaultQuota,
    remaining: defaultQuota,
    lastResetTime: new Date().toISOString(),
    grantedCredits: [],
    modelUsage: {}
  };

  const now = new Date();
  const lastReset = new Date(credits.lastResetTime);
  const isDifferentDay = now.toDateString() !== lastReset.toDateString();

  if (isDifferentDay) {
    credits.remaining = defaultQuota;
    credits.lastResetTime = now.toISOString();
  }

  let validGranted = (credits.grantedCredits || []).filter(g => new Date(g.expiresAt) > now);

  let needed = cost;
  if (credits.remaining >= needed) {
    credits.remaining -= needed;
    needed = 0;
  } else {
    needed -= credits.remaining;
    credits.remaining = 0;

    // Deduct from granted credits (soonest expiring first)
    validGranted = [...validGranted].sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
    for (const g of validGranted) {
      if (needed <= 0) break;
      if (g.amount >= needed) {
        g.amount -= needed;
        needed = 0;
      } else {
        needed -= g.amount;
        g.amount = 0;
      }
    }
    validGranted = validGranted.filter(g => g.amount > 0);
  }

  credits.totalUsed = (credits.totalUsed || 0) + cost;
  if (!credits.modelUsage) {
    credits.modelUsage = {};
  }
  credits.modelUsage[modelId] = (credits.modelUsage[modelId] || 0) + 1;
  credits.grantedCredits = validGranted;

  updated.agentCredits = credits;
  updated.userType = userType; // ensure userType is synchronized
  return updated;
}
