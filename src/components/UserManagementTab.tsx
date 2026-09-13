import React, { useState, useEffect } from 'react';
import { UniversalModal } from './UniversalModal';
import { 
  Users, 
  Settings, 
  Coins, 
  Clock, 
  Plus, 
  Check, 
  Trash2, 
  Shield, 
  AlertCircle, 
  Activity, 
  UserPlus, 
  Sparkles,
  Info,
  Mail,
  Key,
  RefreshCw,
  UserCheck,
  UserX,
  Copy,
  Lock,
  Search,
  ExternalLink
} from 'lucide-react';
import { UserProfile } from '../types';
import { 
  getAllLocalUsers, 
  updateUserProfile, 
  getAdminSettings, 
  saveAdminSettings, 
  AdminSettings 
} from '../utils/userManagement';
import { getAvailableCredits, DEFAULT_AGENT_COSTS, DEFAULT_DAILY_QUOTA } from '../utils/creditManager';
import { auth } from '../firebase';
import { t, normalizeLocale } from '../utils/i18n';

export function AdminTranslationsTab() {
  const [statusMsg, setStatusMsg] = useState<string>('');
  const handlePush = async () => { 
    setStatusMsg('Pushing...');
    try {
      await fetch('/api/admin/translations/push', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ keys: {} }) });
      setStatusMsg('Pushed successfully!');
    } catch (e: any) {
      setStatusMsg('Push failed: ' + e.message);
    }
  };
  const handlePull = async () => { 
    setStatusMsg('Pulling...');
    try {
      const res = await fetch('/api/admin/translations/pull', { method: 'POST' });
      const data = await res.json();
      setStatusMsg('Pulled successfully!');
    } catch (e: any) {
      setStatusMsg('Pull failed: ' + e.message);
    }
  };
  return (
    <div className="mt-8 border-t border-theme-border pt-4">
      <h3 className="text-xl font-bold mb-2 text-slate-800 dark:text-slate-100">Translations Sync</h3>
      <div className="flex gap-2 items-center">
        <button onClick={handlePush} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded transition-colors">Push to Sheets</button>
        <button onClick={handlePull} className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-4 py-2 rounded transition-colors">Pull from Sheets</button>
        {statusMsg && <span className="text-xs text-slate-500 dark:text-slate-400 font-mono ml-2">{statusMsg}</span>}
      </div>
    </div>
  );
}

export default function UserManagementTab() {
  const adminLang = normalizeLocale(typeof localStorage !== 'undefined' ? localStorage.getItem('preferred_language') : 'en');
  const [activeTab, setActiveTab] = useState<'credits' | 'firebase'>('credits');

  // --- Credits & Configuration Tab States ---
  const [users, setUsers] = useState<any[]>([]);
  const [adminSettings, setAdminSettings] = useState<AdminSettings>(getAdminSettings());
  const [selectedUserEmail, setSelectedUserEmail] = useState<string>('');
  
  // Grant Credits form state
  const [grantAmount, setGrantAmount] = useState<number>(50);
  const [grantDurationHours, setGrantDurationHours] = useState<number>(24);
  const [grantSuccessMsg, setGrantSuccessMsg] = useState<string>('');

  // Cost and Quota edit states
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [editFlashLiteCost, setEditFlashLiteCost] = useState(adminSettings.flashLiteCost);
  const [editStandardCost, setEditStandardCost] = useState(adminSettings.standardCost);
  const [editQuotaDemo, setEditQuotaDemo] = useState(adminSettings.quotaDemo);
  const [editQuotaStandard, setEditQuotaStandard] = useState(adminSettings.quotaStandard);
  const [editQuotaAdmin, setEditQuotaAdmin] = useState(adminSettings.quotaAdmin);

  // Search and filter (Credits Tab)
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'Admin' | 'Demo' | 'Standard'>('all');

  // --- Firebase Auth Tab States ---
  const [firebaseUsers, setFirebaseUsers] = useState<any[]>([]);
  const [loadingFirebase, setLoadingFirebase] = useState(false);
  const [firebaseError, setFirebaseError] = useState('');
  const [firebaseSuccessMsg, setFirebaseSuccessMsg] = useState('');
  
  // Search (Firebase Tab)
  const [firebaseSearchQuery, setFirebaseSearchQuery] = useState('');
  
  // Action Result detail (verification/reset link generated)
  const [actionResult, setActionResult] = useState<{ type: 'verification' | 'password_reset'; email: string; link: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Modal deletion confirmations
  const [confirmDeleteAuthUser, setConfirmDeleteAuthUser] = useState<any | null>(null);
  const [confirmDeleteUserData, setConfirmDeleteUserData] = useState<any | null>(null);
  const [confirmEmailInput, setConfirmEmailInput] = useState('');

  const loadLocalData = async () => {
    const fetchedUsers = await getAllLocalUsers();
    setUsers(fetchedUsers);
    const settings = getAdminSettings();
    setAdminSettings(settings);
  };

  const fetchFirebaseUsers = async () => {
    setLoadingFirebase(true);
    setFirebaseError('');
    setFirebaseSuccessMsg('');
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('No admin user currently logged in.');
      }
      const idToken = await user.getIdToken();
      const response = await fetch('/api/admin/users', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to fetch Firebase registered users.');
      }
      const data = await response.json();
      if (data.success) {
        setFirebaseUsers(data.users || []);
      } else {
        throw new Error(data.error || 'Failed to fetch Firebase users');
      }
    } catch (err: any) {
      console.error('[Admin Auth Fetch Error]', err);
      setFirebaseError(err.message || 'Error occurred while loading Firebase users.');
    } finally {
      setLoadingFirebase(false);
    }
  };

  useEffect(() => {
    loadLocalData();
  }, []);

  useEffect(() => {
    if (activeTab === 'firebase') {
      fetchFirebaseUsers();
    }
  }, [activeTab]);

  // --- Action Handlers: Credits & Config ---
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated: AdminSettings = {
      defaultCredits: adminSettings?.defaultCredits ?? 100,
      maintenanceMode: adminSettings?.maintenanceMode ?? false,
      allowGuestMode: adminSettings?.allowGuestMode ?? true,
      ...adminSettings,
      flashLiteCost: Number(editFlashLiteCost) || DEFAULT_AGENT_COSTS['gemini-3.5-flash-lite'],
      standardCost: Number(editStandardCost) || DEFAULT_AGENT_COSTS['default'],
      quotaDemo: Number(editQuotaDemo) || DEFAULT_DAILY_QUOTA.Demo,
      quotaStandard: Number(editQuotaStandard) || DEFAULT_DAILY_QUOTA.Standard,
      quotaAdmin: Number(editQuotaAdmin) || DEFAULT_DAILY_QUOTA.Admin
    };
    saveAdminSettings(updated);
    setAdminSettings(updated);
    setIsEditingSettings(false);
    await loadLocalData();
    window.dispatchEvent(new Event('storage'));
  };

  const handleGrantCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserEmail) return;

    const matchedUser = users.find(u => u.email === selectedUserEmail);
    if (!matchedUser) return;

    const updatedProfile = { ...matchedUser.profile };
    if (!updatedProfile.agentCredits) {
      updatedProfile.agentCredits = {
        totalUsed: 0,
        dailyQuota: 100,
        remaining: 100,
        lastResetTime: new Date().toISOString(),
        grantedCredits: [],
        modelUsage: {}
      };
    }
    if (!updatedProfile.agentCredits.grantedCredits) {
      updatedProfile.agentCredits.grantedCredits = [];
    }

    const expiresAt = new Date(Date.now() + grantDurationHours * 60 * 60 * 1000).toISOString();
    updatedProfile.agentCredits.grantedCredits.push({
      amount: Number(grantAmount),
      grantedAt: new Date().toISOString(),
      expiresAt
    });

    await updateUserProfile(matchedUser.email, updatedProfile);
    setGrantSuccessMsg(`Successfully granted ${grantAmount} credits to ${matchedUser.nickname}!`);
    setTimeout(() => setGrantSuccessMsg(''), 4000);
    await loadLocalData();
  };

  const handleResetDailyUsage = async (email: string) => {
    const matchedUser = users.find(u => u.email === email);
    if (!matchedUser) return;

    const updatedProfile = { ...matchedUser.profile };
    if (updatedProfile.agentCredits) {
      updatedProfile.agentCredits.remaining = updatedProfile.userType === 'Admin' 
        ? adminSettings.quotaAdmin 
        : (updatedProfile.userType === 'Demo' ? adminSettings.quotaDemo : adminSettings.quotaStandard);
      updatedProfile.agentCredits.lastResetTime = new Date().toISOString();
    }
    await updateUserProfile(email, updatedProfile);
    await loadLocalData();
  };

  const handleChangeUserType = async (email: string, newType: 'Standard' | 'Admin' | 'Demo') => {
    const matchedUser = users.find(u => u.email === email);
    if (!matchedUser) return;

    const updatedProfile = { ...matchedUser.profile };
    updatedProfile.userType = newType;
    
    const newQuota = newType === 'Admin' 
      ? adminSettings.quotaAdmin 
      : (newType === 'Demo' ? adminSettings.quotaDemo : adminSettings.quotaStandard);

    if (updatedProfile.agentCredits) {
      updatedProfile.agentCredits.dailyQuota = newQuota;
      updatedProfile.agentCredits.remaining = newQuota;
    } else {
      updatedProfile.agentCredits = {
        totalUsed: 0,
        dailyQuota: newQuota,
        remaining: newQuota,
        lastResetTime: new Date().toISOString(),
        grantedCredits: [],
        modelUsage: {}
      };
    }

    await updateUserProfile(email, updatedProfile);
    await loadLocalData();
  };

  const filteredLocalUsers = users.filter(u => {
    const matchesSearch = u.email.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          u.nickname.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === 'all' || u.userType === typeFilter;
    return matchesSearch && matchesType;
  });

  // --- Action Handlers: Firebase Auth Admin Actions ---
  const handleResendVerification = async (email: string) => {
    setFirebaseSuccessMsg('');
    setFirebaseError('');
    setActionResult(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('No admin user currently logged in.');
      const idToken = await user.getIdToken();
      
      const response = await fetch('/api/admin/user/resend-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate verification link');
      }
      if (data.success && data.link) {
        setFirebaseSuccessMsg(`Generated verification link for ${email}!`);
        setActionResult({ type: 'verification', email, link: data.link });
      } else {
        throw new Error(data.error || 'Verification link generation failed');
      }
    } catch (err: any) {
      setFirebaseError(err.message || 'Error occurred while resending verification.');
    }
  };

  const handleSendPasswordReset = async (email: string) => {
    setFirebaseSuccessMsg('');
    setFirebaseError('');
    setActionResult(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('No admin user currently logged in.');
      const idToken = await user.getIdToken();
      
      const response = await fetch('/api/admin/user/send-password-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate password reset link');
      }
      if (data.success && data.link) {
        setFirebaseSuccessMsg(`Generated password reset link for ${email}!`);
        setActionResult({ type: 'password_reset', email, link: data.link });
      } else {
        throw new Error(data.error || 'Password reset link generation failed');
      }
    } catch (err: any) {
      setFirebaseError(err.message || 'Error occurred while creating password reset link.');
    }
  };

  const handleDeleteAuthUser = async (targetUser: any) => {
    if (confirmEmailInput.trim().toLowerCase() !== targetUser.email.toLowerCase()) {
      setFirebaseError('Email entry mismatch. User deletion was aborted.');
      return;
    }
    setFirebaseSuccessMsg('');
    setFirebaseError('');
    setActionResult(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('No admin user currently logged in.');
      const idToken = await user.getIdToken();
      
      const response = await fetch('/api/admin/user/auth', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ uid: targetUser.uid })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete user from Firebase Auth.');
      }
      setFirebaseSuccessMsg(`Successfully deleted Firebase Auth registered user account: ${targetUser.email}.`);
      setConfirmDeleteAuthUser(null);
      setConfirmEmailInput('');
      await fetchFirebaseUsers();
    } catch (err: any) {
      setFirebaseError(err.message || 'Error occurred while deleting Auth user.');
    }
  };

  const handleDeleteUserData = async (targetUser: any) => {
    if (confirmEmailInput.trim().toLowerCase() !== targetUser.email.toLowerCase()) {
      setFirebaseError('Email entry mismatch. Data deletion was aborted.');
      return;
    }
    setFirebaseSuccessMsg('');
    setFirebaseError('');
    setActionResult(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('No admin user currently logged in.');
      const idToken = await user.getIdToken();
      
      const response = await fetch('/api/admin/user/data', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ uid: targetUser.uid })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete Firestore document data for this user.');
      }
      setFirebaseSuccessMsg(`Successfully cleared Firestore database document profile for ${targetUser.email}.`);
      setConfirmDeleteUserData(null);
      setConfirmEmailInput('');
    } catch (err: any) {
      setFirebaseError(err.message || 'Error occurred while deleting user data.');
    }
  };

  const copyResultLink = (link: string) => {
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const filteredFirebaseUsers = firebaseUsers.filter(u => 
    u.email.toLowerCase().includes(firebaseSearchQuery.toLowerCase()) ||
    u.uid.toLowerCase().includes(firebaseSearchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-100">
      
      {/* Tab Navigation Menu */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6">
        <button
          type="button"
          onClick={() => {
            setActiveTab('credits');
            setFirebaseError('');
            setFirebaseSuccessMsg('');
            setActionResult(null);
          }}
          className={`pb-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'credits' 
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' 
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4" />
            <span>App Credits & Configuration</span>
          </div>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('firebase');
            setFirebaseError('');
            setFirebaseSuccessMsg('');
            setActionResult(null);
          }}
          className={`pb-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'firebase' 
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' 
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            <span>Firebase Auth Registered Users</span>
          </div>
        </button>
      </div>

      {/* --- TAB 1: CREDITS AND CONFIGURATION --- */}
      {activeTab === 'credits' && (
        <div className="space-y-6">
          {/* Configuration Cards Row */}
          <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-150 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-4.5 h-4.5 text-indigo-500" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  Agent Call Costs & Quotas Configuration
                </h4>
              </div>
              {!isEditingSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setEditFlashLiteCost(adminSettings.flashLiteCost);
                    setEditStandardCost(adminSettings.standardCost);
                    setEditQuotaDemo(adminSettings.quotaDemo);
                    setEditQuotaStandard(adminSettings.quotaStandard);
                    setEditQuotaAdmin(adminSettings.quotaAdmin);
                    setIsEditingSettings(true);
                  }}
                  className="text-xs px-3 py-1 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold border border-indigo-100 dark:border-indigo-900/30 rounded-lg hover:bg-indigo-100/60 transition-colors cursor-pointer"
                >
                  Adjust Settings
                </button>
              )}
            </div>

            {isEditingSettings ? (
              <form onSubmit={handleSaveSettings} className="space-y-4 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Costs Column */}
                  <div className="space-y-3 bg-white dark:bg-slate-950 p-4 border border-slate-150 dark:border-slate-800/80 rounded-xl">
                    <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                      1. Model Call Costs (Credits)
                    </span>
                    <div>
                      <label className="block text-[10px] text-slate-500 font-semibold mb-1">
                        Gemini 3.1 & 3.5 Flash Lite Call Cost
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={editFlashLiteCost}
                        onChange={e => setEditFlashLiteCost(Number(e.target.value))}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 font-mono outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 font-semibold mb-1">
                        All Other Agents Call Cost (e.g. 2.5-Pro, etc.)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={editStandardCost}
                        onChange={e => setEditStandardCost(Number(e.target.value))}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 font-mono outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Quotas Column */}
                  <div className="space-y-3 bg-white dark:bg-slate-950 p-4 border border-slate-150 dark:border-slate-800/80 rounded-xl">
                    <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                      2. User Quotas (Credits / Day)
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[9px] text-slate-500 font-semibold mb-1">
                          Demo User
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={editQuotaDemo}
                          onChange={e => setEditQuotaDemo(Number(e.target.value))}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-theme-border rounded-lg p-1.5 text-xs text-slate-800 dark:text-slate-100 font-mono outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-slate-500 font-semibold mb-1">
                          Standard
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={editQuotaStandard}
                          onChange={e => setEditQuotaStandard(Number(e.target.value))}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-theme-border rounded-lg p-1.5 text-xs text-slate-800 dark:text-slate-100 font-mono outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-slate-500 font-semibold mb-1">
                          Admin
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={editQuotaAdmin}
                          onChange={e => setEditQuotaAdmin(Number(e.target.value))}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-theme-border rounded-lg p-1.5 text-xs text-slate-800 dark:text-slate-100 font-mono outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsEditingSettings(false)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer"
                  >
                    Save Configurations
                  </button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-1">
                <div className="bg-white dark:bg-slate-950 p-4 border border-slate-150 dark:border-slate-850 rounded-xl flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Active Call Rates
                    </span>
                    <p className="font-semibold text-theme-neutral">
                      ⚡ 3.1 & 3.5 Flash Lite: <span className="text-indigo-600 dark:text-indigo-400 font-bold font-mono">{adminSettings.flashLiteCost} credit</span>
                    </p>
                    <p className="font-semibold text-theme-neutral">
                      🎯 Other Agents: <span className="text-indigo-600 dark:text-indigo-400 font-bold font-mono">{adminSettings.standardCost} credits</span>
                    </p>
                  </div>
                  <Coins className="w-8 h-8 text-indigo-500/20" />
                </div>

                <div className="bg-white dark:bg-slate-950 p-4 border border-slate-150 dark:border-slate-850 rounded-xl flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Daily Quota Limits
                    </span>
                    <p className="font-semibold text-theme-neutral">
                      Standard Accounts: <span className="text-emerald-500 font-bold font-mono">{adminSettings.quotaStandard} / day</span>
                    </p>
                    <p className="font-semibold text-theme-neutral">
                      Demo Accounts: <span className="text-amber-500 font-bold font-mono">{adminSettings.quotaDemo} / day</span>
                    </p>
                    <p className="font-semibold text-theme-neutral">
                      Admin Accounts: <span className="text-indigo-500 font-bold font-mono">{adminSettings.quotaAdmin} / day</span>
                    </p>
                  </div>
                  <Activity className="w-8 h-8 text-emerald-500/20" />
                </div>
              </div>
            )}
          </div>

          {/* Grant Extra Credits Dialog form */}
          <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-150 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4.5 h-4.5 text-emerald-500" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Grant Extra Credit to Specific User
              </h4>
            </div>

            {grantSuccessMsg && (
              <div className="p-3 bg-emerald-950/25 border border-emerald-900 text-emerald-400 rounded-xl text-xs font-bold flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>{grantSuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleGrantCredits} className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs items-end">
              <div className="sm:col-span-2">
                <label className="block text-[10px] text-slate-500 font-semibold mb-1">
                  Select User Profile
                </label>
                <select
                  value={selectedUserEmail}
                  onChange={e => setSelectedUserEmail(e.target.value)}
                  className="w-full bg-white dark:bg-slate-950 border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 cursor-pointer"
                  required
                >
                  <option value="">-- Choose Account --</option>
                  {users.map(u => (
                    <option key={u.email} value={u.email}>
                      {u.nickname} ({u.email}) - {u.userType}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 font-semibold mb-1">
                  Amount (Credits)
                </label>
                <input
                  type="number"
                  min="1"
                  value={grantAmount}
                  onChange={e => setGrantAmount(Number(e.target.value))}
                  className="w-full bg-white dark:bg-slate-950 border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 font-mono outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-500 font-semibold mb-1">
                  Duration (Hours)
                </label>
                <select
                  value={grantDurationHours}
                  onChange={e => setGrantDurationHours(Number(e.target.value))}
                  className="w-full bg-white dark:bg-slate-950 border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value={1}>1 Hour</option>
                  <option value={12}>12 Hours</option>
                  <option value={24}>24 Hours (1 Day)</option>
                  <option value={48}>48 Hours (2 Days)</option>
                  <option value={168}>168 Hours (7 Days)</option>
                </select>
              </div>

              <div className="sm:col-span-4 flex justify-end mt-2">
                <button
                  type="submit"
                  disabled={!selectedUserEmail}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Grant Additional Credits</span>
                </button>
              </div>
            </form>
          </div>

          {/* Accounts List Directory */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-500" />
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  User Directory & Consumption Live Logs ({filteredLocalUsers.length} accounts)
                </h4>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <input
                  type="text"
                  placeholder="Search by nickname or email..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="bg-white dark:bg-slate-950 border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500"
                />
                <select
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value as any)}
                  className="bg-white dark:bg-slate-950 border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="all">All Roles</option>
                  <option value="Admin">Admin</option>
                  <option value="Demo">Demo</option>
                  <option value="Standard">Standard</option>
                </select>
              </div>
            </div>

            <div className="border border-slate-150 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-950 text-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-150 dark:border-slate-800 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="p-4">User Details</th>
                      <th className="p-4">Account Type</th>
                      <th className="p-4">Last Login</th>
                      <th className="p-4">Remaining Credits / Quota</th>
                      <th className="p-4 text-center">Model Usage Summary</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                    {filteredLocalUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center p-8 text-slate-400">
                          No matching registered user accounts found.
                        </td>
                      </tr>
                    ) : (
                      filteredLocalUsers.map(user => {
                        const creditsInfo = getAvailableCredits(user.profile);
                        const usage = user.profile.agentCredits?.modelUsage || {};
                        const totalUsedVal = user.profile.agentCredits?.totalUsed || 0;
                        
                        return (
                          <tr key={user.email} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors">
                            <td className="p-4">
                              <div className="font-semibold text-slate-800 dark:text-slate-200">
                                {user.nickname}
                              </div>
                              <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                                {user.email}
                              </div>
                            </td>
                            <td className="p-4">
                              <select
                                value={user.userType}
                                onChange={e => handleChangeUserType(user.email, e.target.value as any)}
                                className="bg-slate-50 dark:bg-slate-900 border border-slate-250 dark:border-slate-800 rounded px-1.5 py-0.5 text-[11px] font-semibold outline-none text-theme-neutral cursor-pointer"
                              >
                                <option value="Standard">Standard</option>
                                <option value="Demo">Demo</option>
                                <option value="Admin">Admin</option>
                              </select>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-1.5 text-slate-500">
                                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span>
                                  {user.lastLogin 
                                    ? new Date(user.lastLogin).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) 
                                    : 'Never'}
                                </span>
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <Coins className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                    {creditsInfo.total} available
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  (Daily: {creditsInfo.daily} remaining, Granted: {creditsInfo.granted})
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="space-y-1.5 flex flex-col items-center">
                                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-full">
                                  {totalUsedVal} total credits used
                                </span>
                                {Object.keys(usage).length > 0 ? (
                                  <div className="flex flex-wrap gap-1 justify-center max-w-[160px]">
                                    {Object.entries(usage).map(([model, count]) => (
                                      <span key={model} className="text-[9px] px-1 bg-slate-100 dark:bg-slate-900 text-slate-500 rounded font-mono" title={model}>
                                        {model.replace('gemini-', '')}: {count as React.ReactNode}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-400 italic">No agent calls yet</span>
                                )}
                              </div>
                            </td>
                            <td className="p-4 text-right">
                              <button
                                type="button"
                                onClick={() => handleResetDailyUsage(user.email)}
                                className="text-[11px] font-bold text-slate-500 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 dark:bg-slate-900 dark:hover:bg-indigo-950/40 border border-theme-border rounded px-2.5 py-1 cursor-pointer transition-colors"
                                title="Refill daily quota immediately"
                              >
                                Refill Quota
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- TAB 2: FIREBASE AUTH REGISTERED USERS --- */}
      {activeTab === 'firebase' && (
        <div className="space-y-6">
          {/* Status Messages */}
          {firebaseError && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/25 border border-rose-250 dark:border-rose-900/50 text-rose-700 dark:text-rose-400 rounded-xl text-xs flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-500" />
              <span><strong>Error:</strong> {firebaseError}</span>
            </div>
          )}

          {firebaseSuccessMsg && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/25 border border-emerald-250 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 rounded-xl text-xs flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <Check className="w-5 h-5 shrink-0 text-emerald-500" />
                <span>{firebaseSuccessMsg}</span>
              </div>
              <button 
                type="button"
                onClick={() => setFirebaseSuccessMsg('')} 
                className="text-[10px] text-slate-400 hover:text-slate-600 underline font-semibold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Verification / Password Reset Action Result Preview */}
          {actionResult && (
            <div className="p-5 bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-150 dark:border-indigo-900 rounded-2xl space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider text-[10px]">
                  Generated Link Result
                </span>
                <button
                  type="button"
                  onClick={() => setActionResult(null)}
                  className="text-[10px] text-slate-400 hover:text-slate-600 underline cursor-pointer"
                >
                  Clear Link
                </button>
              </div>
              <div>
                <p className="text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Recipient: <strong className="text-slate-800 dark:text-slate-100">{actionResult.email}</strong>
                </p>
                <p className="text-slate-500 text-[11px] mb-2">
                  {actionResult.type === 'verification' 
                    ? 'Copy and send this email verification URL to the user to manually verify their email:' 
                    : 'Copy and send this password-reset URL to the user so they can reset their password:'}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={actionResult.link}
                    className="flex-1 bg-white dark:bg-slate-950 border border-indigo-150 dark:border-indigo-900 rounded-lg p-2 font-mono text-[11px] text-indigo-600 dark:text-indigo-400 outline-none select-all"
                  />
                  <button
                    type="button"
                    onClick={() => copyResultLink(actionResult.link)}
                    className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center justify-center cursor-pointer"
                    title="Copy to Clipboard"
                  >
                    {copiedLink ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                {copiedLink && (
                  <span className="block text-[10px] text-emerald-500 font-semibold mt-1">
                    Copied link to clipboard successfully!
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Search, Status, and Controls Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/50 p-4 border border-slate-150 dark:border-slate-800 rounded-2xl">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-500 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Firebase Authentication Registered Accounts Directory
                </h4>
                <p className="text-[10px] text-slate-500">
                  Direct connection with Firebase Auth. List contains {firebaseUsers.length} total users.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search email or UID..."
                  value={firebaseSearchQuery}
                  onChange={e => setFirebaseSearchQuery(e.target.value)}
                  className="bg-white dark:bg-slate-950 border border-theme-border rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 w-[220px]"
                />
              </div>
              <button
                type="button"
                onClick={fetchFirebaseUsers}
                disabled={loadingFirebase}
                className="p-1.5 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 border border-theme-border rounded-lg text-slate-500 hover:text-indigo-600 font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                title="Refresh user list from Firebase Auth"
              >
                <RefreshCw className={`w-4 h-4 ${loadingFirebase ? 'animate-spin' : ''}`} />
                <span>Reload</span>
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="border border-slate-150 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-950 text-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-150 dark:border-slate-800 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="p-4">User Details & UID</th>
                    <th className="p-4">Email Status</th>
                    <th className="p-4">Created Time</th>
                    <th className="p-4">Last Active Sign-In</th>
                    <th className="p-4">Auth Providers</th>
                    <th className="p-4 text-right">Administrative Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                  {loadingFirebase ? (
                    <tr>
                      <td colSpan={6} className="text-center p-12">
                        <div className="flex flex-col items-center justify-center gap-3">
                          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                          <span className="text-slate-400 font-semibold">Fetching registered accounts from Firebase Auth...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredFirebaseUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-12 text-slate-400">
                        No registered Firebase Auth accounts found matching your query.
                      </td>
                    </tr>
                  ) : (
                    filteredFirebaseUsers.map(u => (
                      <tr key={u.uid} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors">
                        <td className="p-4">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                            {u.email || <span className="italic text-slate-400">No email registered</span>}
                          </div>
                          <div className="text-[9px] font-mono text-slate-400 mt-0.5" title="Firebase UID">
                            UID: {u.uid}
                          </div>
                        </td>
                        <td className="p-4">
                          {u.emailVerified ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30">
                              <UserCheck className="w-3 h-3" />
                              <span>Verified</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30">
                              <AlertCircle className="w-3 h-3" />
                              <span>Unverified</span>
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-slate-500 dark:text-slate-400 font-mono text-[10px]">
                          {u.createdAt ? new Date(u.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'N/A'}
                        </td>
                        <td className="p-4 text-slate-500 dark:text-slate-400 font-mono text-[10px]">
                          {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Never'}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-1">
                            {u.providers && u.providers.length > 0 ? (
                              u.providers.map((prov: string) => (
                                <span key={prov} className="text-[9px] font-bold font-mono px-2 py-0.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 rounded uppercase">
                                  {prov === 'password' ? '🔐 Email / Pass' : prov === 'google.com' ? '🌐 Google OAuth' : prov}
                                </span>
                              ))
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">No providers</span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {/* Resend Verification */}
                            <button
                              type="button"
                              onClick={() => handleResendVerification(u.email)}
                              className="px-2.5 py-1 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20 text-[10px] font-bold rounded text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer flex items-center gap-1"
                              title="Generate an email verification URL"
                            >
                              <Mail className="w-3 h-3 shrink-0" />
                              <span>Verify Link</span>
                            </button>

                            {/* Reset Password */}
                            <button
                              type="button"
                              onClick={() => handleSendPasswordReset(u.email)}
                              className="px-2.5 py-1 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20 text-[10px] font-bold rounded text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer flex items-center gap-1"
                              title="Generate a password reset URL"
                            >
                              <Key className="w-3 h-3 shrink-0" />
                              <span>Reset Link</span>
                            </button>

                            {/* Delete Firestore User Data */}
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteUserData(u);
                                setConfirmEmailInput('');
                              }}
                              className="px-2.5 py-1 border border-slate-200 dark:border-slate-800 hover:border-orange-500 hover:bg-orange-50/30 dark:hover:bg-orange-950/20 text-[10px] font-bold rounded text-slate-500 hover:text-orange-600 transition-colors cursor-pointer flex items-center gap-1"
                              title="Delete all user's stored Firestore documents"
                            >
                              <Trash2 className="w-3 h-3 shrink-0 text-orange-500" />
                              <span>Clear Data</span>
                            </button>

                            {/* Delete Firebase Auth User */}
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteAuthUser(u);
                                setConfirmEmailInput('');
                              }}
                              className="px-2.5 py-1 border border-slate-200 dark:border-slate-800 hover:border-rose-500 hover:bg-rose-50/30 dark:hover:bg-rose-950/20 text-[10px] font-bold rounded text-slate-500 hover:text-rose-600 transition-colors cursor-pointer flex items-center gap-1"
                              title="Completely delete user account from Firebase Authentication"
                            >
                              <UserX className="w-3 h-3 shrink-0 text-rose-500" />
                              <span>Delete User</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- MODALS FOR SAFE DELETIONS --- */}

      {/* Modal for Deleting Auth User */}
      <UniversalModal
        isOpen={!!confirmDeleteAuthUser}
        onClose={() => {
          setConfirmDeleteAuthUser(null);
          setConfirmEmailInput('');
        }}
        title={t(adminLang, 'delAuthTitle')}
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                setConfirmDeleteAuthUser(null);
                setConfirmEmailInput('');
              }}
              className="px-3.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors font-semibold"
            >
              {t(adminLang, 'cancel')}
            </button>
            <button
              type="button"
              onClick={() => confirmDeleteAuthUser && handleDeleteAuthUser(confirmDeleteAuthUser)}
              disabled={!confirmDeleteAuthUser || confirmEmailInput.trim().toLowerCase() !== confirmDeleteAuthUser.email.toLowerCase()}
              className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-45 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
            >
              <UserX className="w-4 h-4" />
              <span>{t(adminLang, 'delConfirmAuth')}</span>
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {t(adminLang, 'delWarnAuthA')} <strong className="text-slate-800 dark:text-slate-200">{confirmDeleteAuthUser?.email}</strong> {t(adminLang, 'delWarnAuthB')} <strong>{t(adminLang, 'delWarnAuthC')}</strong>{t(adminLang, 'delWarnAuthD')}
          </p>
          <div className="space-y-2">
            <label className="block text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-bold">
              {t(adminLang, 'delTypeEmail')}
            </label>
            <input
              type="text"
              value={confirmEmailInput}
              onChange={(e) => setConfirmEmailInput(e.target.value)}
              placeholder={confirmDeleteAuthUser?.email}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-350 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-rose-500 text-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
      </UniversalModal>

      <AdminTranslationsTab />
      {/* Modal for Deleting User Data */}
      <UniversalModal
        isOpen={!!confirmDeleteUserData}
        onClose={() => {
          setConfirmDeleteUserData(null);
          setConfirmEmailInput('');
        }}
        title={t(adminLang, 'delDataTitle')}
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                setConfirmDeleteUserData(null);
                setConfirmEmailInput('');
              }}
              className="px-3.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors font-semibold"
            >
              {t(adminLang, 'cancel')}
            </button>
            <button
              type="button"
              onClick={() => confirmDeleteUserData && handleDeleteUserData(confirmDeleteUserData)}
              disabled={!confirmDeleteUserData || confirmEmailInput.trim().toLowerCase() !== confirmDeleteUserData.email.toLowerCase()}
              className="px-4 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-45 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              <span>{t(adminLang, 'delConfirmData')}</span>
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {t(adminLang, 'delWarnDataA')} <strong className="text-slate-800 dark:text-slate-200">{confirmDeleteUserData?.email}</strong>{t(adminLang, 'delWarnDataB')} <strong>{t(adminLang, 'delWarnDataC')}</strong> {t(adminLang, 'delWarnDataD')}
          </p>
          <div className="space-y-2">
            <label className="block text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-bold">
              {t(adminLang, 'delTypeEmail')}
            </label>
            <input
              type="text"
              value={confirmEmailInput}
              onChange={(e) => setConfirmEmailInput(e.target.value)}
              placeholder={confirmDeleteUserData?.email}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-350 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-orange-500 text-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
      </UniversalModal>

    </div>
  );
}
