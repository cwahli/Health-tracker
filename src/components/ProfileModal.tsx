import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { UserProfile } from '../types';
import { translations } from '../utils/translations';
import { ETHNICITY_SELECT_OPTIONS, displayAccountType, interpolate } from '../utils/i18n';
import { getAvailableCredits } from '../utils/creditManager';
import { compressImage } from '../utils/imageCompressor';
import { Eye, EyeOff, RefreshCw, LogOut, ShieldCheck, Coins } from 'lucide-react';

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

export interface ProfileModalProps {
  profile: UserProfile;
  setProfile: (p: UserProfile | ((prev: UserProfile) => UserProfile) | any) => void;
  onSaveProfile?: (p: UserProfile) => Promise<void>;
  hideSensitive: boolean;
  setHideSensitive: (h: boolean) => void;
  onSignOut: () => void;
  onClose: () => void;
  onOpenTheme: () => void;
  onOpenAdmin: () => void;
}

export default function ProfileModal({
  profile,
  setProfile,
  onSaveProfile,
  hideSensitive,
  setHideSensitive,
  onSignOut,
  onClose,
  onOpenTheme,
  onOpenAdmin,
}: ProfileModalProps) {
  const [nickname, setNickname] = useState(profile.nickname);
  const [age, setAge] = useState<number | string>(profile.age);
  const [ethnicity, setEthnicity] = useState(profile.ethnicity);
  const [weight, setWeight] = useState<number | string>(profile.weight);
  const [height, setHeight] = useState<number | string>(profile.height);
  const [bloodType, setBloodType] = useState<string>(profile.bloodType || '');
  const [gender, setGender] = useState<string>(profile.gender || 'Unknown');
  const [unitPreference, setUnitPreference] = useState<string>(profile.unitPreference || 'SI');
  const [timezone, setTimezone] = useState<string>(profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [language, setLanguage] = useState<'en' | 'fr' | 'zh' | 'id'>(() => {
    return (profile?.language && ['en', 'fr', 'zh', 'id'].includes(profile.language)) ? (profile.language as 'en' | 'fr' | 'zh' | 'id') : 'en';
  });
  const t = translations[profile.language] || translations.en;

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
    if (profile.language && ['en', 'fr', 'zh', 'id'].includes(profile.language)) {
      setLanguage(profile.language as 'en' | 'fr' | 'zh' | 'id');
    }
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
      timezone,
      language: (language || profile.language || 'en') as 'en' | 'fr' | 'zh' | 'id',
      lastUpdatedAt: Date.now()
    };
    localStorage.setItem('preferred_language', finalProfile.language);
    if (onSaveProfile) {
      onSaveProfile(finalProfile);
    } else {
      setProfile(finalProfile);
    }
    onClose();
  };

  const isAdmin = profile?.userType === 'Admin' || profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com';

  return createPortal((
        <div id="profile-edit-modal" className="fixed inset-0 z-[100] bg-white dark:bg-slate-900 sm:bg-slate-900/60 sm:backdrop-blur-sm flex items-center justify-center sm:p-4 overflow-hidden">
          <div className="w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 sm:border border-slate-200 dark:border-slate-800 sm:rounded-3xl sm:shadow-xl max-w-lg animation-fade-in text-slate-800 dark:text-slate-100 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-theme-text">{t.editProfile}</h2>
                <p className="text-xs text-slate-450 dark:text-slate-400">{t.editProfileDesc}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  id="profile-save-btn"
                  onClick={handleSave}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
                >
                  {t.save}
                </button>
                <button
                  onClick={() => onClose()}
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
                alt={t.userProfileAlt}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.uploadPhoto}</span>
                <button
                  type="button"
                  id="edit-theme-link"
                  onClick={() => {
                    onOpenTheme();
                  }}
                  className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  {t.editTheme}
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
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{t.agentCredits}</span>
                  </div>
                  <span className="text-[10px] bg-indigo-100/80 dark:bg-indigo-950/65 text-indigo-700 dark:text-indigo-450 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    {displayAccountType(profile.language, creditInfo.userType)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/85 rounded-xl p-2">
                    <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{t.availableCredits}</span>
                    <span className="text-lg font-black text-slate-800 dark:text-slate-100">{creditInfo.total}</span>
                    <span className="block text-[8px] text-slate-500">{t.creditsLeft}</span>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/85 rounded-xl p-2">
                    <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{t.dailyQuota}</span>
                    <span className="text-lg font-black text-slate-800 dark:text-slate-100">{creditInfo.daily}</span>
                    <span className="block text-[8px] text-slate-500">{t.resetsIn} {creditInfo.nextResetStr}</span>
                  </div>
                </div>

                {/* Granted Credits / Duration info */}
                {creditInfo.grantedDetails.length > 0 && (
                  <div className="bg-white/80 dark:bg-slate-900/60 border border-slate-100/50 dark:border-slate-800/45 rounded-xl p-2.5 space-y-1.5 text-left">
                    <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">{t.grantedCredits}</span>
                    {creditInfo.grantedDetails.map((gc, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[10px] text-slate-650 dark:text-slate-350">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">{interpolate(t.plusNCredits, { n: gc.amount })}</span>
                        <span className="text-[9px] font-mono text-slate-400">{interpolate(t.expiresOn, { date: new Date(gc.expiresAt).toLocaleDateString(profile.language === 'id' ? 'id-ID' : undefined) })}</span>
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
                {ETHNICITY_SELECT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{t[opt.labelKey]}</option>
                ))}
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
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.bloodType}</label>
              <select
                value={bloodType}
                onChange={(e) => setBloodType(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="">{t.unknown}</option>
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
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.gender}</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="Unknown">{t.unknown}</option>
                <option value="Male">{t.male}</option>
                <option value="Female">{t.female}</option>
                <option value="Other">{t.otherGender}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.unitPreference}</label>
              <select
                value={unitPreference}
                onChange={(e) => setUnitPreference(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="SI">{t.unitSiInternational}</option>
                <option value="US">{t.unitUs}</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.timezoneLabel}</label>
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
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.accountEmail}</span>
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
                    onOpenAdmin();
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
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4">{t.preferencesAndSession}</span>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {/* Language Selection */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.languageLabel}</label>
                  <select
                    id="lang-selector"
                    value={language}
                    onChange={(e) => {
                      const newLang = e.target.value as 'en' | 'fr' | 'zh' | 'id';
                      setLanguage(newLang);
                      localStorage.setItem('preferred_language', newLang);
                      const updated = {
                        ...profile,
                        language: newLang,
                        lastUpdatedAt: Date.now()
                      };
                      setProfile(updated);
                      if (onSaveProfile) {
                        onSaveProfile(updated);
                      }
                    }}
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
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.privacyMode}</label>
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

              {/* Account Sign Out Action */}
              <div className="border-t border-slate-100 dark:border-slate-800/85 pt-4 mt-2">
                <button
                  type="button"
                  id="profile-modal-bottom-signout-btn"
                  onClick={() => {
                    onClose();
                    onSignOut();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-900/40 rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer"
                  title={t.signOut}
                >
                  <LogOut className="w-4 h-4" />
                  <span>{t.signOut}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
